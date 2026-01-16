const axios = require('axios');
const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const CONFIG = require('../config');

class DiscordService {
    constructor() {
        this.tokenTicker = 'ETH';
        this.client = null;
        this.isReady = false;

        // Store reference to get live data (set by strategy)
        this.getStateCallback = null;
    }

    /**
     * Initialize the Discord bot for slash commands
     */
    async initBot() {
        if (!CONFIG.DISCORD.BOT_TOKEN || !CONFIG.DISCORD.GUILD_ID) {
            console.log('[Discord] Bot token or guild ID not configured, skipping bot initialization');
            return;
        }

        console.log('[Discord] Initializing bot...');

        this.client = new Client({
            intents: [GatewayIntentBits.Guilds]
        });

        // Register slash commands
        await this.registerCommands();

        // Handle interactions
        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isChatInputCommand()) return;

            if (interaction.commandName === 'wdyt') {
                await this.handleStatCommand(interaction);
            }
        });

        this.client.on('ready', () => {
            console.log(`[Discord] Bot logged in as ${this.client.user.tag}`);
            this.isReady = true;
        });

        this.client.on('error', (error) => {
            console.error('[Discord] Bot error:', error.message);
        });

        try {
            await this.client.login(CONFIG.DISCORD.BOT_TOKEN);
        } catch (error) {
            console.error('[Discord] Failed to login bot:', error.message);
        }
    }

    /**
     * Register slash commands with Discord
     */
    async registerCommands() {
        const commands = [
            new SlashCommandBuilder()
                .setName('wdyt')
                .setDescription('Get current ETH hourly market status and readings')
                .toJSON()
        ];

        const rest = new REST({ version: '10' }).setToken(CONFIG.DISCORD.BOT_TOKEN);

        try {
            const appId = Buffer.from(CONFIG.DISCORD.BOT_TOKEN.split('.')[0], 'base64').toString();
            console.log(`[Discord] Registering slash commands for app ${appId} in guild ${CONFIG.DISCORD.GUILD_ID}...`);

            await rest.put(
                Routes.applicationGuildCommands(appId, CONFIG.DISCORD.GUILD_ID),
                { body: commands }
            );
            console.log('[Discord] Slash commands registered successfully');
        } catch (error) {
            console.error('[Discord] Failed to register commands:', error.message);
            if (error.code) console.error('[Discord] Error code:', error.code);
        }
    }

    /**
     * Handle /stat command
     */
    async handleStatCommand(interaction) {
        await interaction.deferReply();

        try {
            // Get current state from the strategy
            const state = this.getStateCallback ? await this.getStateCallback() : null;

            if (!state) {
                await interaction.editReply('Unable to fetch current state. Bot may still be initializing.');
                return;
            }

            const now = new Date();
            const minutes = now.getMinutes();
            const isInWindow = minutes >= CONFIG.ETH_HOURLY.ENTRY_WINDOW_START &&
                minutes <= CONFIG.ETH_HOURLY.ENTRY_WINDOW_END;

            // Build the embed
            // Calculate Signal Strength & Bar
            const score = state.score || 0;
            let strength = 'WEAK';
            if (score >= 75) strength = '🔥 EXTREME';
            else if (score >= 50) strength = '✅ MODERATE';
            else strength = '☁️ LOW';

            const bars = Math.round(score / 10);
            const filled = '🟩'.repeat(bars);
            const empty = '⬜'.repeat(10 - bars);
            const progressBar = `${filled}${empty}`;

            const embed = new EmbedBuilder()
                .setTitle(`📊 ETH Hourly Status | ${state.recommendation || 'WAIT'}`)
                .setColor(state.ethMove >= 0 ? 0x00ff00 : 0xff0000)
                .setDescription(
                    `**${strength}**\n` +
                    `\`${progressBar}\` **${score}/100**`
                )
                .setTimestamp()
                .setFooter({ text: 'Window Licker Bot' });

            // 1. Market Data
            embed.addFields(
                { name: '💰 Market', value: `**$${state.ethPrice?.toFixed(2)}**\n${state.ethMove >= 0 ? '📈' : '📉'} ${state.ethMove >= 0 ? '+' : ''}$${state.ethMove?.toFixed(2)}`, inline: true },
                { name: '₿ BTC', value: `${state.btcMove >= 0 ? '✅' : '⚠️'} ${state.btcMove >= 0 ? '+' : ''}$${state.btcMove?.toFixed(2)}`, inline: true },
                { name: '⏱️ Window', value: `${isInWindow ? '🟢 OPEN' : '🔴 CLOSED'}\n${timeLeft}m left`, inline: true }
            );

            // 2. Sentiment & Risk
            const upOdds = state.upOdds ? (state.upOdds * 100).toFixed(0) : '0';
            const downOdds = state.downOdds ? (state.downOdds * 100).toFixed(0) : '0';

            embed.addFields(
                { name: '📊 Sentiment', value: `📈 **${upOdds}%** UP\n📉 **${downOdds}%** DOWN`, inline: true },
                { name: '⚡ Velocity', value: `${state.velocity?.velocityStatus === 'RAPID_RISE' ? '🚀' : state.velocity?.velocityStatus === 'FALLING' ? '📉' : '➡️'} ${state.velocity?.velocityStatus || 'STABLE'}`, inline: true },
                { name: '🛡️ Risk', value: `Bounce: **${state.bounceRisk || 'N/A'}**\nPrem: ${state.premium?.toFixed(3)}%`, inline: true }
            );

            if (state.hasPosition) {
                embed.addFields(
                    { name: '📍 Active Position', value: `${state.positionDirection} @ $${state.positionEntry?.toFixed(2)}`, inline: false }
                );
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            console.error('[Discord] Error handling /stat command:', error);
            await interaction.editReply('Error fetching status. Please try again.');
        }
    }

    /**
     * Set callback to get live state from strategy
     */
    setStateCallback(callback) {
        this.getStateCallback = callback;
    }

    // ============ Original Webhook Methods ============

    async sendAlert(webhookUrl, content, embed) {
        if (!webhookUrl) {
            console.warn('[Discord] No webhook URL provided, skipping alert.');
            return;
        }

        try {
            await axios.post(webhookUrl, {
                content: content,
                embeds: embed ? [embed] : []
            });
        } catch (error) {
            console.error('[Discord] Failed to send alert:', error.message);
        }
    }

    createEmbed(title, description, color, fields = [], footerText = 'Window Licker Bot') {
        return {
            title,
            description,
            color,
            fields,
            footer: { text: footerText },
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = new DiscordService();
