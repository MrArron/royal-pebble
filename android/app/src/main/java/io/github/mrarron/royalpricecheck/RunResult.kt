package io.github.mrarron.royalpricecheck

import org.json.JSONArray
import org.json.JSONObject

data class Booking(
    val reservationId: String,
    val shipName: String,
    val sailDate: String,
    val nights: Int?,
    val stateroom: String,
    val checkinLabel: String,
    val finalPaymentDate: String,
    val balanceDue: Boolean?,
    val friendlyName: String,
)

data class PriceDrop(
    val reservationId: String,
    val itemName: String,
    val guestName: String,
    val paid: Double,
    val current: Double,
    val currency: String,
    val perNight: Boolean,
    val alert: Boolean,
    val decision: String,
) {
    val saving: Double get() = paid - current
    val key: String get() = "$reservationId|$itemName|$guestName|$current"
}

data class GuestCheckin(val status: String, val window: String)

data class RunResult(
    val finishedAt: Long,
    val exitCode: Int,
    val error: String?,
    val script: String,
    val bookings: List<Booking>,
    val drops: List<PriceDrop>,
    val guestCheckin: List<GuestCheckin>,
    val itemsChecked: Int,
    val raw: String,
) {
    val ok: Boolean get() = exitCode == 0
    val alerts: List<PriceDrop> get() = drops.filter { it.alert }

    companion object {
        fun failure(message: String) = RunResult(
            System.currentTimeMillis(), 1, message, "", emptyList(), emptyList(), emptyList(), 0,
            JSONObject().put("exitCode", 1).put("error", message).toString(),
        )

        fun parse(json: String, finishedAt: Long): RunResult {
            val o = JSONObject(json)
            val stored = if (o.has("finishedAt")) o.getLong("finishedAt") else finishedAt
            o.put("finishedAt", stored)
            return RunResult(
                finishedAt = stored,
                exitCode = o.optInt("exitCode", 1),
                error = o.optStringOrNull("error"),
                script = o.optString("script"),
                bookings = o.optJSONArray("bookings").objects().map {
                    Booking(
                        reservationId = it.optString("reservation_id"),
                        shipName = it.optStringOrNull("ship_name") ?: it.optString("ship_code"),
                        sailDate = it.optString("sail_date"),
                        nights = if (it.isNull("nights")) null else it.optInt("nights"),
                        stateroom = listOfNotNull(
                            it.optStringOrNull("stateroom_type"),
                            it.optStringOrNull("stateroom_number"),
                        ).joinToString(" "),
                        checkinLabel = it.optStringOrNull("checkin_label") ?: "TBD",
                        finalPaymentDate = it.optString("final_payment_date"),
                        balanceDue = if (it.isNull("balance_due")) null else it.optInt("balance_due") == 1,
                        friendlyName = it.optString("friendly_name"),
                    )
                },
                drops = o.optJSONArray("drops").objects().map {
                    PriceDrop(
                        reservationId = it.optString("reservation_id"),
                        itemName = it.optStringOrNull("item_name") ?: it.optString("item_kind"),
                        guestName = it.optString("guest_name"),
                        paid = it.optDouble("paid_price"),
                        current = it.optDouble("current_price"),
                        currency = it.optString("currency"),
                        perNight = it.optInt("per_night") == 1,
                        alert = it.optBoolean("alert"),
                        decision = it.optString("rebook_decision"),
                    )
                },
                guestCheckin = o.optJSONArray("guestCheckin").objects().map {
                    GuestCheckin(it.optString("status"), it.optString("window"))
                },
                itemsChecked = o.optInt("itemsChecked"),
                raw = o.toString(),
            )
        }

        private fun JSONArray?.objects(): List<JSONObject> =
            if (this == null) emptyList() else (0 until length()).mapNotNull { optJSONObject(it) }

        private fun JSONObject.optStringOrNull(key: String): String? =
            if (isNull(key)) null else optString(key).takeIf { it.isNotBlank() && it != "null" }
    }
}

/** "20270101" -> "Jan 1, 2027" (falls back to the input). */
fun prettyDate(yyyymmdd: String): String = runCatching {
    val d = java.time.LocalDate.parse(yyyymmdd, java.time.format.DateTimeFormatter.BASIC_ISO_DATE)
    d.format(java.time.format.DateTimeFormatter.ofPattern("MMM d, yyyy"))
}.getOrDefault(yyyymmdd)
