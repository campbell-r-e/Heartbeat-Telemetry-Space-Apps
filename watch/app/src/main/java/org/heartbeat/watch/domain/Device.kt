package org.heartbeat.watch.domain

/**
 * Which watch sent a readings batch, and its battery: `device` on every `POST /api/readings` (Phase 5 contract).
 * [watchId] is a random id made once per install, never the hardware serial or MAC address.
 */
data class DeviceInfo(val watchId: String, val batteryPct: Int?)
