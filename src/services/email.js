const nodemailer = require('nodemailer');
const CONFIG = require('../config');

class EmailService {
    constructor() {
        this.transporter = null;
        this.initialized = false;
    }

    init() {
        if (!CONFIG.EMAIL.USER || !CONFIG.EMAIL.PASS) {
            console.log('[Email] Credentials not configured. Email alerts disabled.');
            return;
        }

        this.transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: CONFIG.EMAIL.USER,
                pass: CONFIG.EMAIL.PASS
            }
        });

        this.initialized = true;
        console.log(`[Email] Service initialized (Sender: ${CONFIG.EMAIL.USER})`);
    }

    /**
     * Send a High Confidence "Sure Shot" Alert
     * @param {Object} data - { price, score, move, direction, recommendation }
     */
    async sendHighConfidenceAlert(data) {
        if (!this.initialized) return;

        const { price, score, move, direction, recommendation } = data;
        const subject = `🚀 SURE SHOT: ${recommendation} ETH (Score: ${score})`;

        const html = `
            <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
                <h2 style="color: #008000; margin-top: 0;">${recommendation} ALERT</h2>
                <p><strong>Score:</strong> ${score}/100</p>
                <p><strong>ETH Price:</strong> $${price.toFixed(2)}</p>
                <p><strong>Move:</strong> ${move >= 0 ? '+' : ''}$${move.toFixed(2)}</p>
                <p><strong>Direction:</strong> ${direction}</p>
                <hr>
                <p style="font-size: 12px; color: #888;">
                    This is a high-confidence signal from Window Licker Bot.<br>
                    Triggered at ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET.
                </p>
            </div>
        `;

        const mailOptions = {
            from: CONFIG.EMAIL.USER,
            to: CONFIG.EMAIL.TO,
            subject: subject,
            html: html
        };

        try {
            await this.transporter.sendMail(mailOptions);
            console.log(`[Email] Sent high-confidence alert to ${CONFIG.EMAIL.TO}`);
        } catch (error) {
            console.error('[Email] Failed to send email:', error);
        }
    }
}

module.exports = new EmailService();
