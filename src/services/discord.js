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
            const embed = new EmbedBuilder()
                .setTitle('📊 ETH Hourly Status')
                .setColor(state.ethMove >= 0 ? 0x00ff00 : 0xff0000)
                .setTimestamp()
                .setFooter({ text: 'Window Licker Bot' });

            // Price info
            embed.addFields(
                { name: '💰 ETH Price', value: `$${state.ethPrice?.toFixed(2) || 'N/A'}`, inline: true },
                { name: '📈 ETH Move', value: `${state.ethMove >= 0 ? '+' : ''}$${state.ethMove?.toFixed(2) || 'N/A'}`, inline: true },
                { name: '₿ BTC Move', value: `${state.btcMove >= 0 ? '+' : ''}$${state.btcMove?.toFixed(2) || 'N/A'}`, inline: true },
            );

            // Timing
            const timeToWindow = minutes < CONFIG.ETH_HOURLY.ENTRY_WINDOW_START
                ? CONFIG.ETH_HOURLY.ENTRY_WINDOW_START - minutes
                : 0;
            const timeLeft = 60 - minutes;

            embed.addFields(
                { name: '⏱️ Current Minute', value: `${minutes}`, inline: true },
                { name: '🎯 Entry Window', value: isInWindow ? '✅ ACTIVE' : `⏳ In ${timeToWindow} min`, inline: true },
                { name: '⏰ Hour Ends', value: `${timeLeft} min`, inline: true },
            );

            // Odds
            if (state.upOdds !== null || state.downOdds !== null) {
                embed.addFields(
                    { name: '📊 UP Odds', value: state.upOdds ? `${(state.upOdds * 100).toFixed(1)}%` : 'N/A', inline: true },
                    { name: '📊 DOWN Odds', value: state.downOdds ? `${(state.downOdds * 100).toFixed(1)}%` : 'N/A', inline: true },
                );
            }

            // Velocity
            if (state.velocity) {
                const velEmoji = state.velocity.velocityStatus === 'RAPID_RISE' ? '🚀' :
                    state.velocity.velocityStatus === 'RISING' ? '📈' :
                        state.velocity.velocityStatus === 'FALLING' ? '📉' : '➡️';
                embed.addFields(
                    { name: '⚡ Odds Velocity', value: `${velEmoji} ${state.velocity.velocityStatus} (${state.velocity.velocityPercent?.toFixed(2) || 0}%/min)`, inline: false },
                );
            }

            // Premium / Bounce Risk
            if (state.premium !== undefined) {
                const premiumEmoji = state.bounceRisk === 'LOW' ? '✅' :
                    state.bounceRisk === 'MEDIUM' ? '⚠️' : '❌';
                embed.addFields(
                    { name: '💹 Premium Index', value: `${state.premium >= 0 ? '+' : ''}${state.premium?.toFixed(3) || 0}%`, inline: true },
                    { name: '🎢 Bounce Risk', value: `${premiumEmoji} ${state.bounceRisk || 'N/A'}`, inline: true },
                );
            }

            // Recommendation (if in window)
            if (isInWindow && state.recommendation) {
                const recEmoji = state.recommendation.includes('BUY') ? '✅' :
                    state.recommendation === 'SMALL BET' ? '⚠️' : '❌';
                embed.addFields(
                    { name: '🎯 Recommendation', value: `${recEmoji} **${state.recommendation}**`, inline: false },
                );
            }

            // Checklist summary
            if (state.score !== undefined) {
                embed.addFields(
                    { name: '💯 Confidence Score', value: `${state.score}/100`, inline: true },
                );
            } else if (state.checksCount !== undefined) {
                embed.addFields(
                    { name: '📋 Checks Passed', value: `${state.checksCount}`, inline: true },
                );
            }

            // Position info
            if (state.hasPosition) {
                embed.addFields(
                    { name: '📍 Active Position', value: `${state.positionDirection} @ $${state.positionEntry?.toFixed(2)}`, inline: false },
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
