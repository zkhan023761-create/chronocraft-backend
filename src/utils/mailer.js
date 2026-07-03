'use strict';

const nodemailer = require('nodemailer');

// Initialize Nodemailer transporter with Gmail OAuth2
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    type: 'OAuth2',
    user: process.env.GMAIL_FROM_EMAIL,
    clientId: process.env.GMAIL_CLIENT_ID,
    clientSecret: process.env.GMAIL_CLIENT_SECRET,
    refreshToken: process.env.GMAIL_REFRESH_TOKEN,
  }
});

const fromEmail = process.env.GMAIL_FROM_EMAIL || 'chronocraft.rk@gmail.com';

/**
 * Generic helper to send email via Gmail OAuth2 with console logging fallback
 */
async function sendEmail({ to, subject, html }) {
  // Always log to console for debugging/development visibility
  console.log(`\n==================================================`);
  console.log(`[Mailer] SENDING EMAIL (GMAIL OAUTH2)`);
  console.log(`[Mailer] From:    ${fromEmail}`);
  console.log(`[Mailer] To:      ${to}`);
  console.log(`[Mailer] Subject: ${subject}`);
  console.log(`[Mailer] HTML Content:\n${html}`);
  console.log(`==================================================\n`);

  try {
    const info = await transporter.sendMail({
      from: fromEmail,
      to,
      subject,
      html,
    });

    console.log('[Mailer] Email sent successfully via Gmail OAuth2. Message ID:', info.messageId);
  } catch (err) {
    console.error('[Mailer] Failed to dispatch email via Gmail OAuth2:', err.message);
    if (process.env.NODE_ENV !== 'development') {
      throw err;
    }
  }
}

/**
 * Send OTP Verification Email
 */
async function sendOtpEmail({ to, name, otp }) {
  const subject = 'Your Chrono Craft Verification Code';
  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #0A0A0A; color: #FFFFFF; padding: 30px; border-radius: 8px; max-width: 600px; margin: 0 auto; border: 1px solid #C9A84C;">
      <h2 style="color: #C9A84C; font-family: 'Times New Roman', Times, serif; text-transform: uppercase; letter-spacing: 2px;">Chrono Craft Vault</h2>
      <p>Hello ${name || 'Valued Customer'},</p>
      <p>We received a request to access your Chrono Craft account. Use the verification code below to complete the verification process:</p>
      <div style="background-color: #161616; border: 1px solid #333333; padding: 20px; font-size: 32px; font-weight: bold; letter-spacing: 5px; text-align: center; color: #C9A84C; border-radius: 4px; margin: 20px 0;">
        ${otp}
      </div>
      <p style="font-size: 12px; color: #666666;">This code is valid for 10 minutes. If you did not request this, you can safely ignore this email.</p>
    </div>
  `;
  await sendEmail({ to, subject, html });
}

/**
 * Send Order Confirmation Email
 */
async function sendOrderConfirmationEmail({ to, name, order }) {
  const subject = `Order Confirmation - ${order.order_number}`;
  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #0A0A0A; color: #FFFFFF; padding: 30px; border-radius: 8px; max-width: 600px; margin: 0 auto; border: 1px solid #C9A84C;">
      <h2 style="color: #C9A84C; font-family: 'Times New Roman', Times, serif; text-transform: uppercase; letter-spacing: 2px;">Chrono Craft Order Confirmed</h2>
      <p>Hello ${name || 'Customer'},</p>
      <p>Thank you for your order! Your order has been placed successfully. Below are the order details:</p>
      <div style="background-color: #161616; padding: 20px; border-radius: 4px; border: 1px solid #333333; margin: 20px 0;">
        <p><strong>Order Number:</strong> ${order.order_number}</p>
        <p><strong>Total Amount:</strong> $${order.total}</p>
        <p><strong>Status:</strong> ${order.status}</p>
      </div>
      <p style="font-size: 12px; color: #666666;">We will send you another update once your horological collection items ship.</p>
    </div>
  `;
  await sendEmail({ to, subject, html });
}

/**
 * Send Order Status Update Email
 */
async function sendOrderStatusEmail({ to, name, order, status }) {
  const subject = `Order Status Update - ${order.order_number}`;
  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #0A0A0A; color: #FFFFFF; padding: 30px; border-radius: 8px; max-width: 600px; margin: 0 auto; border: 1px solid #C9A84C;">
      <h2 style="color: #C9A84C; font-family: 'Times New Roman', Times, serif; text-transform: uppercase; letter-spacing: 2px;">Order Status Update</h2>
      <p>Hello ${name || 'Customer'},</p>
      <p>The status of your order <strong>${order.order_number}</strong> has been updated to:</p>
      <div style="background-color: #161616; padding: 20px; border-radius: 4px; border: 1px solid #333333; font-size: 20px; font-weight: bold; color: #C9A84C; text-align: center; margin: 20px 0; text-transform: uppercase;">
        ${status}
      </div>
      <p style="font-size: 12px; color: #666666;">If you have any questions, please contact our support team.</p>
    </div>
  `;
  await sendEmail({ to, subject, html });
}

module.exports = {
  sendOtpEmail,
  sendOrderConfirmationEmail,
  sendOrderStatusEmail,
};
