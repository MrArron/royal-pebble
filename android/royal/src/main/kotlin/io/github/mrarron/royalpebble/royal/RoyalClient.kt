package io.github.mrarron.royalpebble.royal

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.io.IOException
import java.net.SocketTimeoutException
import java.time.Instant
import java.time.temporal.ChronoUnit

/** A problem worth showing the user as it is. Fixed wording plus a status code, never Royal's reply. */
class RoyalException(message: String) : Exception(message)

/** Headers for logged-in requests, from [RoyalClient.login]. Lives only for one download. */
class RoyalAuth internal constructor(internal val token: String, val accountId: String) {
    internal fun headers(): Map<String, String> =
        linkedMapOf("Access-Token" to token, "account-id" to accountId, "vds-id" to accountId)

    override fun toString(): String = "RoyalAuth(<token>)"
}

/** A download with login: the bundle, and why the booking details are missing when they are. */
data class LoginDownload(val bundle: JsonObject, val mineError: String?)

/**
 * Royal Caribbean's web endpoints, ported from the network parts of
 * src/pkjs/royal.js. tools/cruise-sync/cruise_sync.py is the reference for the
 * headers and every request. These are unofficial endpoints: requests are
 * sequential and minimal (one itinerary call and a few schedule pages per
 * download, plus a sign-in and the booking calls with login), never polled.
 *
 * Calls block; run them off the main thread. The app key and login client are
 * Royal's public web-app values (from jdeath/CheckRoyalCaribbeanPrice, MIT).
 */
class RoyalClient(
    private val transport: Transport,
    private val sleep: (Long) -> Unit = { Thread.sleep(it) },
    private val now: () -> Instant = { Instant.now() },
) {
    companion object {
        const val API = "https://aws-prd.api.rccl.com"
        const val COMMERCE = "$API/en/royal/web/commerce-api"
        const val APPKEY = "hyNNqIPHHzaLzVpcICPdAdbFV8yvTsAm"
        const val LOGIN_URL = "https://www.royalcaribbean.com/auth/oauth2/access_token"
        const val LOGIN_CLIENT = "Basic ZzlTMDIzdDc0NDczWlVrOTA5Rk42OEYwYjRONjdQU09oOTJvMDR2TDBCUjY1MzdwSTJ5Mmg5NE02QmJVN0Q2SjpX" +
            "NjY4NDZrUFF2MTc1MDk3NW9vZEg1TTh6QzZUYTdtMzBrSDJRNzhsMldtVTUwRkNncXBQMTN3NzczNzdrN0lC"
        /** cruise_sync.py's browser user agent: Royal's CDN turns away some non-browser clients. */
        const val USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0"
        const val TIMEOUT_MS = 30_000
        const val PAGE = 200
        /** Attempts per public or logged-in GET, as cruise_sync.get_json: network hiccups and 5xx only. */
        const val ATTEMPTS = 3

        const val ERR_REFUSED = "Royal Caribbean refused the request (403). Try the backup tool."
        const val ERR_INVALID = "The reply from Royal Caribbean was not valid data."
        const val ERR_UNREACHABLE = "Could not reach Royal Caribbean. Check your internet connection."
        const val ERR_TIMEOUT = "Royal Caribbean did not answer in time. Try again."
        const val ERR_LOGIN_REJECTED = "Royal Caribbean didn't accept that email and password."
        const val ERR_LOGIN_REFUSED = "Royal Caribbean refused the sign-in (403). Use the Windows sync tool instead."
        const val ERR_LOGIN_TOKEN = "Signed in, but couldn't read the login token. Royal may have changed their sign-in."
        const val ERR_NO_BOOKING = "Signed in, but found no booking on your account for that ship and date."
        fun errStatus(status: Int) = "Royal Caribbean returned error $status."
    }

    private class Reply(val status: Int, val json: JsonElement?, val error: String?)

    /** One request, no retries. Never throws: the error is fixed wording (it can reach the usage log). */
    private fun once(request: HttpRequest): Reply {
        val res = try {
            transport.send(request)
        } catch (e: SocketTimeoutException) {
            return Reply(0, null, ERR_TIMEOUT)
        } catch (e: IOException) {
            return Reply(0, null, ERR_UNREACHABLE)
        }
        if (res.status == 403) return Reply(res.status, null, ERR_REFUSED)
        if (res.status >= 400) return Reply(res.status, null, errStatus(res.status))
        return try {
            Reply(res.status, parseJson(res.body), null)
        } catch (e: Exception) {
            Reply(res.status, null, ERR_INVALID)
        }
    }

    private fun baseHeaders(): LinkedHashMap<String, String> =
        linkedMapOf("AppKey" to APPKEY, "Accept" to "application/json", "User-Agent" to USER_AGENT)

    /** A GET with cruise_sync's retries: up to [ATTEMPTS] for network trouble, bad data and 5xx; never for 4xx. */
    private fun getJson(url: String, auth: RoyalAuth? = null, params: Map<String, JsonElement?> = emptyMap()): JsonElement {
        val qs = params.entries.joinToString("&") { encodeUriComponent(it.key) + "=" + encodeUriComponent(it.value.jsString()) }
        val headers = baseHeaders()
        auth?.headers()?.let { headers.putAll(it) }
        val request = HttpRequest("GET", if (qs.isEmpty()) url else "$url?$qs", headers)
        var last: Reply? = null
        for (attempt in 1..ATTEMPTS) {
            val r = once(request)
            if (r.error == null) return r.json!!
            if (r.status in 400..499) throw RoyalException(r.error)
            last = r
            if (attempt < ATTEMPTS) sleep(2000L * attempt)
        }
        throw RoyalException(last!!.error!!)
    }

    private fun params(vararg pairs: Pair<String, Any?>): Map<String, JsonElement?> =
        LinkedHashMap<String, JsonElement?>().apply {
            pairs.forEach { (k, v) -> put(k, if (v is String) JsonPrimitive(v) else v as JsonElement?) }
        }

    // ------------------------------------------------------------ public data

    fun fetchShips(): List<RoyalParse.Ship> = RoyalParse.parseShips(getJson("$API/en/royal/web/v2/ships"))

    /** The sail dates Royal lists for a ship, 'YYYY-MM-DD' from [oldest] on (config.js loadSailings). */
    fun fetchSailDates(code: String, oldest: String? = null): List<String> =
        RoyalParse.parseSailDates(getJson("$API/en/royal/web/v3/ships/${encodeUriComponent(code)}/voyages").toString(), oldest)

    /** The sailing as a cruise data bundle (docs/DATA_FORMAT.md, v1). sailDate: 'YYYY-MM-DD'. */
    fun download(ship: RoyalParse.Ship, sailDate: String): JsonObject {
        val date8 = sailDate.replace("-", "")
        val itinerary = RoyalParse.parseItinerary(getJson("$API/en/royal/web/v3/ships/${ship.code}/sailDate/$date8"))
        if (itinerary.isEmpty()) throw RoyalException("Royal Caribbean has no itinerary for ${ship.name} on that date.")
        val acc = RoyalParse.ScheduleAcc()
        var offset = 0
        while (true) {
            val page = getJson("$API/en/royal/web/v3/products?sailingID=${ship.code}$date8&limit=$PAGE&offset=$offset")
            val count = RoyalParse.addProducts(acc, page)
            if (count >= PAGE && offset < 20000) offset += PAGE else break
        }
        return obj {
            str("format", "cruise-watch")
            num("v", 1)
            str("generated", now().truncatedTo(ChronoUnit.SECONDS).toString())
            raw("ship", obj { str("code", ship.code); str("name", ship.name) })
            str("sailDate", sailDate)
            raw("itinerary", itinerary)
            raw("schedule", RoyalParse.finishSchedule(acc))
        }
    }

    // ------------------------------------------------------------ with login

    /**
     * Signs in. The password goes into this one request body and nowhere else.
     * Headers as cruise_sync.login (Content-Type, Authorization, User-Agent); no retries.
     */
    fun login(email: String, password: String): RoyalAuth {
        val body = "grant_type=password&username=" + encodeUriComponent(email) + "&password=" +
            encodeUriComponent(password) + "&scope=openid+profile+email+vdsid"
        val r = once(HttpRequest("POST", LOGIN_URL, linkedMapOf(
            "Content-Type" to "application/x-www-form-urlencoded",
            "Authorization" to LOGIN_CLIENT,
            "User-Agent" to USER_AGENT,
        ), body))
        if (r.status == 400 || r.status == 401) throw RoyalException(ERR_LOGIN_REJECTED)
        if (r.status == 403) throw RoyalException(ERR_LOGIN_REFUSED)
        if (r.error != null) throw RoyalException(if (r.status >= 400) "Sign-in failed (error ${r.status})." else r.error)
        val token = r.json["access_token"].let { if (it.truthy()) it.jsString() else "" }
        val account = RoyalParse.accountOf(token) ?: throw RoyalException(ERR_LOGIN_TOKEN)
        return RoyalAuth(token, account)
    }

    /**
     * Stateroom, cabin details and purchased add-ons for the booking on this
     * sailing (docs/DATA_FORMAT.md, mine). Parts that fail are skipped with a
     * note. A booked excursion's meeting time and length come from the public
     * listing ([schedule]) when it has them; the catalog is asked only for what is missing.
     */
    fun fetchMine(auth: RoyalAuth, code: String, date8: String, schedule: JsonElement?): JsonObject {
        val pub = RoyalParse.publicExcursionTimes(schedule)
        val res = getJson("$API/v1/profileBookings/enriched/${encodeUriComponent(auth.accountId)}", auth,
            params("brand" to "R", "includeCheckin" to "true"))
        val bookings = res["payload"].objOrEmpty()["profileBookings"].arrOrEmpty()
        val match = bookings.filter {
            it["shipCode"].string() == code && (if (it["sailDate"].truthy()) it["sailDate"].jsString() else "").replace("-", "") == date8
        }
        if (match.isEmpty()) throw RoyalException(ERR_NO_BOOKING + RoyalParse.bookingList(bookings))
        if (match.size == 1) return mineFor(auth, code, date8, pub, match[0], 0, false)
        val (own, unsure) = pickOwnBooking(auth, match)
        return mineFor(auth, code, date8, pub, own, match.size - 1, unsure)
    }

    /** Several bookings on one sailing: the one the signed-in guest sails on, by the account profile. */
    private fun pickOwnBooking(auth: RoyalAuth, match: List<JsonElement>): Pair<JsonElement, Boolean> {
        val profile = try {
            getJson("$API/en/royal/web/v3/guestAccounts/${encodeUriComponent(auth.accountId)}", auth)
        } catch (e: RoyalException) {
            return match[0] to true
        }
        val me = RoyalParse.guestIdentity(profile["payload"].objOrEmpty())
        val own = match.filter { RoyalParse.sailsOn(it, me) }
        return (own.ifEmpty { match })[0] to (own.size != 1)
    }

    private fun mineFor(auth: RoyalAuth, code: String, date8: String, pub: Map<List<String>, JsonObject>,
                        b: JsonElement, others: Int, unsure: Boolean): JsonObject {
        // Guarantee bookings list "GTY" until a cabin is assigned; a real one has digits.
        val room = if (b["stateroomNumber"].truthy()) b["stateroomNumber"].jsString() else ""
        val me = b["passengers"].arrOrEmpty().firstOrNull { it["passengerId"].jsString() == b["passengerId"].jsString() }
        val mine = ObjBuilder()
        mine.str("stateroom", if (Regex("[0-9]").containsMatchIn(room)) room else null)
        mine.str("deck", orNone(b["deckNumber"]))
        mine.str("muster", orNone(b["musterStation"]))
        // Terminal arrival appointment, empty until online check-in is done.
        mine.str("arrival", if (me != null) RoyalParse.hhmm(me["arrivalTime"]) ?: orNone(me["arrivalTime"]) else null)
        mine.raw("orders", EMPTY_ARRAY)
        if (others > 0) {
            mine.num("otherBookings", others)
            if (unsure) mine.bool("bookingUnsure", true)
        }
        try {
            val (ports, tz) = RoyalParse.parseVoyage(getJson("$API/en/royal/web/v3/ships/voyages/$code$date8/enriched", auth))
            mine.raw("ports", ports)
            mine.str("embarkTimeZone", tz)
        } catch (e: RoyalException) {
            mine.str("voyageError", e.message)
        }
        val params = params("passengerId" to b["passengerId"], "reservationId" to b["bookingId"],
            "sailingId" to "$code$date8", "includeMedia" to "false")
        val base = "$COMMERCE/calendar/v1/$code/orderHistory"
        val history = try {
            getJson(base, auth, params)["payload"].objOrEmpty()
        } catch (e: RoyalException) {
            mine.str("ordersError", e.message)
            return mine.build()
        }
        val orders = (history["myOrders"].arrOrEmpty() + history["ordersOthersHaveBookedForMe"].arrOrEmpty())
            .filter { it["orderCode"].truthy() && it["status"].string() != "CANCELLED" }
        val entries = mutableListOf<JsonObject>()
        for (order in orders) {
            val detail = try {
                getJson("$base/${order["orderCode"].jsString()}", auth, params)
            } catch (e: RoyalException) {
                continue
            }
            for (item in detail["payload"].objOrEmpty()["orderHistoryDetailItems"].arrOrEmpty()) {
                val summary = item["productSummary"].objOrEmpty()
                val guests = item["guests"].arrOrEmpty().filter { it["orderStatus"].string() != "CANCELLED" }
                if (guests.isEmpty() || item["status"].string() == "CANCELLED") continue
                val cat = summary["productTypeCategory"].objOrEmpty()
                val entry = ObjBuilder()
                entry.str("title", RoyalParse.clean(summary["title"]))
                entry.raw("category", cat["id"] ?: JsonPrimitive(""))
                entry.num("guests", guests.size)
                // Timed bookings (shore excursions, and probably dining and shows)
                // carry the booked session; packages and credits don't.
                val offering = item["offering"].objOrEmpty()
                val (date, time) = RoyalParse.isoParts(offering["dateTime"])
                if (date != null) {
                    entry.str("date", date)
                    entry.str("time", time)
                    if (offering["dayOfCruise"].isCount()) entry.raw("day", jsNumber(offering["dayOfCruise"].number()!!))
                    if (offering["portCode"].truthy()) entry.raw("port", offering["portCode"])
                    val title = RoyalParse.clean(summary["title"])
                    pub[listOf(title.lowercase(), date, time ?: "")]?.forEach { (k, v) -> entry.raw(k, v) }
                    if ("meet" !in entry.map || "minutes" !in entry.map) {
                        try {
                            offeringTimes(auth, code, date8, b, summary, offering).forEach { (k, v) -> entry.raw(k, v) }
                        } catch (e: RoyalException) {
                            // the booked time is enough
                        }
                    }
                }
                entries += entry.build()
            }
        }
        fun s(o: JsonObject, k: String) = o[k].string()
        val sorted = entries.sortedWith(compareBy({ s(it, "date") ?: "9999" }, { s(it, "time") ?: "" }, { s(it, "title") ?: "" }))
        mine.raw("orders", JsonArray(sorted))
        return mine.build()
    }

    /** Meeting time, end time and length of a booked, timed product, from its catalog page. */
    private fun offeringTimes(auth: RoyalAuth, code: String, date8: String, booking: JsonElement,
                              summary: JsonObject, offering: JsonObject): JsonObject {
        val prefix = summary["productTypeCategory"].objOrEmpty()["id"]
        val product = summary["baseOptions"].arrOrEmpty().getOrNull(0)["selected"].objOrEmpty()["code"]
        if (!prefix.truthy() || !product.truthy()) return EMPTY_OBJECT
        val detail = getJson("$COMMERCE/catalog/v2/$code/categories/${prefix.jsString()}/products/${product.jsString()}", auth,
            params("reservationId" to booking["bookingId"], "passengerId" to booking["passengerId"],
                "currencyIso" to (if (booking["bookingCurrency"].truthy()) booking["bookingCurrency"] else JsonPrimitive("USD")),
                "startDate" to "${date8.substring(0, 4)}-${date8.substring(4, 6)}-${date8.substring(6, 8)}"))
        return RoyalParse.parseOfferingTimes(detail, offering)
    }

    /**
     * Signs in, downloads the sailing as usual, then adds `mine`. Throws when
     * nothing downloaded; [LoginDownload.mineError] says why the booking details didn't.
     */
    fun downloadWithLogin(ship: RoyalParse.Ship, sailDate: String, email: String, password: String): LoginDownload {
        val auth = login(email, password)
        val bundle = download(ship, sailDate)
        return try {
            val mine = fetchMine(auth, ship.code, sailDate.replace("-", ""), bundle["schedule"])
            LoginDownload(JsonObject(bundle + ("mine" to mine)), null)
        } catch (e: RoyalException) {
            LoginDownload(bundle, e.message)
        }
    }

    private fun orNone(value: JsonElement?): String? = RoyalParse.clean(value).ifEmpty { null }
}
