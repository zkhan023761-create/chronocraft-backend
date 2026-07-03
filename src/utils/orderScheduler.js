'use strict';

/**
 * Order Auto-Progression Scheduler
 * ──────────────────────────────────
 * After an admin confirms an order, it automatically advances:
 *
 *   confirmed  ──(24 h)──▶ processing
 *   processing ──(24 h)──▶ shipped       (2 days total from confirmed)
 *   shipped    ──(24 h)──▶ delivered     (3 days total from confirmed)
 *
 * The scheduler runs every 15 minutes and uses statusHistory timestamps
 * to decide when to promote an order to the next stage.
 */

const { supabase } = require('../config/database');
const { sendOrderStatusEmail } = require('./mailer');

// ── Timing config (milliseconds) ────────────────────────────────────────────
const DELAYS = {
  confirmed:  24 * 60 * 60 * 1000,   // 24 h → move to processing
  processing: 24 * 60 * 60 * 1000,   // 24 h → move to shipped
  shipped:    24 * 60 * 60 * 1000,   // 24 h → move to delivered
};

const NEXT_STATUS = {
  confirmed:  'processing',
  processing: 'shipped',
  shipped:    'delivered',
};

const NOTE = {
  confirmed:  'Order is now being processed.',
  processing: 'Your watch has been dispatched and is on its way.',
  shipped:    'Your luxury timepiece has been delivered. Thank you for choosing Chrono Craft!',
};

// ── Helper: get timestamp of a specific status entry ────────────────────────
function getStatusTimestamp(order, statusKey) {
  if (!order.status_history) return null;
  const entry = order.status_history.find((h) => h.status === statusKey);
  return entry ? new Date(entry.timestamp).getTime() : null;
}

// ── Main job ─────────────────────────────────────────────────────────────────
async function runOrderProgressionJob() {
  try {
    const now = Date.now();

    // Fetch all orders that are still in a promotable state
    const { data: orders, error } = await supabase
      .from('orders')
      .select('*')
      .in('status', ['confirmed', 'processing', 'shipped']);

    if (error || !orders) return;

    for (const order of orders) {
      const currentStatus  = order.status;
      const delay          = DELAYS[currentStatus];
      const nextStatus     = NEXT_STATUS[currentStatus];
      if (!delay || !nextStatus) continue;

      // When did the order enter its current status?
      const enteredAt = getStatusTimestamp(order, currentStatus);
      if (!enteredAt) continue;

      // Not enough time has passed yet — skip
      if (now - enteredAt < delay) continue;

      // ── Advance status ──────────────────────────────────────────────────
      const newStatus = nextStatus;
      const history = order.status_history || [];
      history.push({
        status:    newStatus,
        timestamp: new Date(),
        note:      NOTE[currentStatus],
      });

      const { data: updatedOrder, error: updateError } = await supabase
        .from('orders')
        .update({
          status: newStatus,
          status_history: history
        })
        .eq('id', order.id)
        .select()
        .single();
        
      if (updateError) {
        console.error(`[Scheduler] Update failed for ${order.order_number}:`, updateError.message);
        continue;
      }

      console.log(
        `[Scheduler] Order ${order.order_number}: ${currentStatus} → ${newStatus}`
      );

      // Fire-and-forget customer email
      try {
        const { data: customer } = await supabase.from('users').select('*').eq('id', order.user_id).single();
        if (customer?.email) {
          sendOrderStatusEmail({
            to:     customer.email,
            name:   customer.name,
            order:  updatedOrder,
            status: newStatus,
          }).catch((e) =>
            console.error(`[Scheduler] Email failed for ${order.order_number}:`, e.message)
          );
        }
      } catch (_) { /* non-blocking */ }
    }
  } catch (err) {
    console.error('[Scheduler] orderProgressionJob error:', err.message);
  }
}

// ── Start the scheduler ──────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 15 * 60 * 1000; // check every 15 minutes

function startOrderScheduler() {
  console.log('[Scheduler] Order auto-progression scheduler started (poll every 15 min).');

  // Run once immediately on startup (catches any pending orders from before restart)
  runOrderProgressionJob();

  // Then run on interval
  const timer = setInterval(runOrderProgressionJob, POLL_INTERVAL_MS);

  // Ensure the interval doesn't keep Node alive by itself if server is shutting down
  if (timer.unref) timer.unref();
}

module.exports = { startOrderScheduler };
