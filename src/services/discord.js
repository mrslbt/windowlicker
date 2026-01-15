const axios = require('axios');
const CONFIG = require('../config');

class DiscordService {
    constructor() {
        this.tokenTicker = 'ETH'; // Default
    }

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

    // Generic builder for simple embeds
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
