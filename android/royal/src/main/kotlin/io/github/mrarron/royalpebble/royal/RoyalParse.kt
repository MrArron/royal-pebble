package io.github.mrarron.royalpebble.royal

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.text.Normalizer

/**
 * The pure parts of src/pkjs/royal.js: turning Royal's replies into the cruise
 * data bundle (docs/DATA_FORMAT.md, v1). Function for function the same as the
 * JS (and tools/cruise-sync/cruise_sync.py); where the two references differ,
 * this follows the JS, because the JS is what it replaces on the phone.
 * Keep all three in step: the shared fixtures in test/fixtures/ check them.
 */
object RoyalParse {
    // Product types kept for the schedule (docs/DATA_FORMAT.md).
    private val SCHEDULE_TYPES = setOf("NON_REVENUE_SCHEDULABLE", "ENTERTAINMENT", "ACTIVITIES", "SHOREX")
    private val PAID_TYPES = setOf("ACTIVITIES", "SHOREX")
    const val EXCURSION_PARENT = "Shore excursions"
    const val EXCURSION_CHILD = ""
    private val SKIP_TITLES = Regex("nextcruise", RegexOption.IGNORE_CASE)
    private val NOTE_SKIP = Regex("^(images are illustrative|this activity has a fee|fee applies)", RegexOption.IGNORE_CASE)
    private const val NOTE_MAX = 120
    private const val EARLY_MAX = 120L
    private const val MEET_MAX = 240L
    private val EARLY_TEXT = listOf(
        Regex("\\barrive (\\d+) minutes? early\\b", RegexOption.IGNORE_CASE),
        Regex("\\bsign up (?:at the venue )?(\\d+) minutes? before\\b", RegexOption.IGNORE_CASE),
    )
    private val SHORT_FILLER = setOf(
        "a", "an", "and", "at", "by", "competition", "for", "game", "in", "of", "on", "seminar", "show",
        "the", "to", "with", "your",
    )
    val FIELDS = listOf("title", "venue", "cat", "date", "time", "minutes", "featured", "reservation", "paid", "price",
        "info", "pid")

    // ------------------------------------------------------------ text

    /** Plain, watch-friendly ASCII text: straight quotes, no trademark symbols. */
    fun clean(text: String?): String {
        if (text.isNullOrEmpty()) return ""
        var s = text
            .replace(Regex("[‘’]"), "'")
            .replace(Regex("[“”]"), "\"")
            .replace(Regex("[–—]"), "-")
            .replace(" ", " ")
            .replace("…", "...")
            .replace(Regex("[®℠™©]"), "")
        s = Normalizer.normalize(s, Normalizer.Form.NFKD)
        // Like the JS: anything outside printable ASCII goes, tabs and newlines too.
        return s.replace(Regex("[^\\x20-\\x7e]"), "").replace(Regex("\\s+"), " ").trim()
    }

    /** clean() of a raw JSON value, as JS `clean(x)` reads any value. */
    fun clean(value: JsonElement?): String = if (!value.truthy()) "" else clean(value.jsString())

    /** "HERO OF THE SEAS" -> "Hero of the Seas"; leaves mixed case alone. */
    fun shipName(name: String?): String {
        val s = clean(name)
        if (s != s.uppercase()) return s
        return s.lowercase().replace(Regex("\\b[a-z]")) { it.value.uppercase() }.replace(" Of The ", " of the ")
    }

    private fun capitalize(s: String): String = if (s.isEmpty()) s else s.substring(0, 1).uppercase() + s.substring(1).lowercase()

    private fun orNone(value: JsonElement?): String? = clean(value).ifEmpty { null }

    private fun pad2(n: Long): String = if (n < 10) "0$n" else n.toString()

    // ------------------------------------------------------------ ships and itinerary

    data class Ship(val code: String, val name: String)

    fun parseShips(json: JsonElement?): List<Ship> =
        json["payload"]["ships"].arrOrEmpty()
            .filter { it["brand"].string() == "R" }
            .map { Ship(it["shipCode"].jsString(), shipName(clean(it["name"]))) }
            .sortedBy { it.name }

    /** Sail dates ('YYYY-MM-DD', sorted, unique) in a /voyages reply, read like config.js loadSailings. */
    fun parseSailDates(text: String, oldest: String? = null): List<String> =
        Regex("\"sailDate\"\\s*:\\s*\"(\\d{8})\"").findAll(text)
            .map { val d = it.groupValues[1]; "${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)}" }
            .filter { oldest == null || it >= oldest }
            .toSortedSet().toList()

    // '20270309T070000' -> ['2027-03-09', '07:00']
    private fun splitStamp(stamp: JsonElement?): Pair<String?, String?> {
        if (!stamp.truthy()) return null to null
        val s = stamp.jsString()
        if (s.length < 13) return null to null
        return "${s.substring(0, 4)}-${s.substring(4, 6)}-${s.substring(6, 8)}" to "${s.substring(9, 11)}:${s.substring(11, 13)}"
    }

    fun parseItinerary(json: JsonElement?): JsonArray {
        val info = json["payload"].objOrEmpty()["sailingInfo"].firstIfArray()
        val events = info["itinerary"]["events"].arrOrEmpty()
        return JsonArray(events.map { ev ->
            val port = ev["port"].objOrEmpty()
            val kind = port["portType"].let { if (it.truthy()) it.jsString() else "UNKNOWN" }
            val arrive = splitStamp(port["arrivalDateTime"])
            val depart = splitStamp(port["departureDateTime"])
            // Royal fills unused times with placeholders (00:00, 23:59); drop them.
            obj {
                raw("day", ev["day"])
                str("date", arrive.first)
                str("port", clean(port["portName"]))
                raw("code", port["portCode"])
                str("type", kind)
                str("arrive", if (kind == "CRUISING" || kind == "EMBARK") null else arrive.second)
                str("depart", if (kind == "CRUISING" || kind == "DEBARK") null else depart.second)
            }
        })
    }

    // ------------------------------------------------------------ schedule

    /** The adult "from" price in dollars (cents kept), or null when none is listed. */
    private fun productPrice(p: JsonElement): Double? {
        val v = p["startingFromPrice"].objOrEmpty()["adultPrice"].number() ?: return null
        return if (v > 0) jsRound(v * 100) / 100 else null
    }

    /** [min, max] years (either may be null). */
    data class Age(val low: Long?, val high: Long?) {
        fun toJson(): JsonArray = jsonArrayOf(low, high)
    }

    /** Royal's age restriction wording -> [min, max] years, or null when it isn't a limit. */
    fun restrictionAge(text: JsonElement?): Age? {
        val s = clean(text).lowercase()
        Regex("minimum (\\d+) years? old").matchEntire(s)?.let { return Age(it.groupValues[1].toLong(), null) }
        Regex("maximum (\\d+) years? old").matchEntire(s)?.let { return Age(null, it.groupValues[1].toLong()) }
        return Regex("(\\d+) to (\\d+) years? old").matchEntire(s)?.let { Age(it.groupValues[1].toLong(), it.groupValues[2].toLong()) }
    }

    fun restrictionAge(text: String): Age? = restrictionAge(JsonPrimitive(text))

    /** Age patterns in a title or venue name: (18+), (13-17), (Ages 13-17), (17 & Under), Adults-Only. */
    fun textAge(text: String?): Age? {
        val s = clean(text).lowercase()
        Regex("\\((?:ages )?(\\d+)\\s*-\\s*(\\d+)\\)").find(s)?.let { return Age(it.groupValues[1].toLong(), it.groupValues[2].toLong()) }
        Regex("\\((\\d+)\\+\\)").find(s)?.let { return Age(it.groupValues[1].toLong(), null) }
        Regex("\\((\\d+) & under\\)").find(s)?.let { return Age(null, it.groupValues[1].toLong()) }
        return if (Regex("\\badults?[- ]only\\b").containsMatchIn(s)) Age(18, null) else null
    }

    /** From restrictions, age experiences, then title and venue patterns; the tightest wins. */
    fun ageOf(p: JsonElement, title: String, venue: String): Age? {
        val found = mutableListOf<Age?>()
        p["restrictions"].arrOrEmpty().forEach { r ->
            if (r["restrictionType"].string() == "age") found += restrictionAge(r["restrictionDisplayText"])
        }
        p["experiences"].arrOrEmpty().forEach { e ->
            val id = e["experienceID"].let { if (it.truthy()) it.jsString() else "" }
            Regex("ages/age(\\d+)").matchEntire(id)?.let { found += Age(it.groupValues[1].toLong(), null) }
        }
        found += textAge(title)
        found += textAge(venue)
        var low: Long? = null
        var high: Long? = null
        found.filterNotNull().forEach { a ->
            if (a.low != null && (low == null || a.low > low!!)) low = a.low
            if (a.high != null && (high == null || a.high < high!!)) high = a.high
        }
        return if (low == null && high == null) null else Age(low, high)
    }

    // '0745' -> 465, or null.
    private fun clockMinutes(hhmm4: JsonElement?): Long? {
        val s = if (hhmm4.truthy()) hhmm4.jsString() else ""
        return if (Regex("\\d{4}").matches(s)) s.substring(0, 2).toLong() * 60 + s.substring(2, 4).toLong() else null
    }

    /** Minutes to arrive before an offering's start, or null. */
    fun earlyOf(p: JsonElement, o: JsonElement): Long? {
        val start = clockMinutes(o["offeringTime"])
        if (start == null || start == 0L) return null  // untimed (00:00) or missing
        if (p["productType"].objOrEmpty()["productType"].string() == "SHOREX") {
            val meet = clockMinutes(o["meetingTime"])
            return if (meet != null && meet < start) minOf(start - meet, MEET_MAX) else null
        }
        val lead = p["productDuration"].objOrEmpty()["leadTimeInMinutes"]
        if (lead.isCount() && lead.number()!! > 0) return minOf(lead.number()!!.toLong(), EARLY_MAX)
        for (a in p["advisements"].arrOrEmpty()) {
            for (re in EARLY_TEXT) {
                val m = re.find(clean(a["advisementTitle"])) ?: continue
                val n = m.groupValues[1].toLong()
                if (n > 0) return minOf(n, EARLY_MAX)
            }
        }
        return null
    }

    private fun words(text: String): Set<String> =
        Regex("[a-z0-9]+").findAll(text.lowercase()).map { val w = it.value; if (w.length > 3 && w.endsWith("s")) w.dropLast(1) else w }.toSet()

    private fun saysMore(short: String, title: String): Boolean {
        val have = words(title)
        val extra = words(short).any { it !in have && it !in SHORT_FILLER }
        return extra || ('(' in short && '(' !in title)
    }

    /** [id, text] notes for a product (see royal.js notesOf). */
    fun notesOf(p: JsonElement, title: String): List<Pair<String, String>> {
        val out = mutableListOf<Pair<String, String>>()
        fun add(id: JsonElement?, raw: JsonElement?) {
            val text = clean(raw)
            if (text.isNotEmpty() && text.length <= NOTE_MAX && !NOTE_SKIP.containsMatchIn(text) &&
                out.none { it.second.lowercase() == text.lowercase() }) {
                out += clean(id) to text
            }
        }
        val short = clean(p["productShortDescription"])
        if (short.isNotEmpty() && saysMore(short, title)) add(JsonPrimitive("short"), JsonPrimitive(short))
        p["restrictions"].arrOrEmpty().forEach { r ->
            if (r["restrictionType"].string() != "age" || restrictionAge(r["restrictionDisplayText"]) == null) {
                add(r["restrictionID"], r["restrictionDisplayText"])
            }
        }
        p["advisements"].arrOrEmpty().forEach { a -> add(a["advisementID"], a["advisementTitle"]) }
        if (p["isWaiverRequired"].truthy() && out.none { Regex("waiver|disclaimer", RegexOption.IGNORE_CASE).containsMatchIn(it.second) }) {
            add(JsonPrimitive("waiver"), JsonPrimitive("Signed waiver required"))
        }
        return out
    }

    /** Collects schedule pages (royal.js newScheduleAcc / addProducts / finishSchedule). */
    class ScheduleAcc {
        internal val cats = Table()
        internal val venues = Table()
        internal val notes = Table()
        internal val infos = Table()
        internal val events = mutableListOf<JsonArray>()
        internal val seen = HashSet<String>()
    }

    /** A list of distinct JSON values with their first index (JS `index(table, value)`). */
    internal class Table {
        val values = mutableListOf<JsonElement>()
        private val at = HashMap<JsonElement, Int>()
        fun index(value: JsonElement): Int = at.getOrPut(value) { values += value; values.size - 1 }
    }

    /** Adds one page of products; returns the number of products on the page (kept or not). */
    fun addProducts(acc: ScheduleAcc, json: JsonElement?): Int {
        val products = json["payload"].objOrEmpty()["products"].arrOrEmpty()
        for (p in products) {
            val kind = p["productType"].objOrEmpty()["productType"].string()
            if (kind !in SCHEDULE_TYPES || SKIP_TITLES.containsMatchIn(p["productTitle"].let { if (it.truthy()) it.jsString() else "" })) continue
            var parent = "Other"
            var child = ""
            val pcs = p["productCategory"].arrOrEmpty()
            if (kind == "SHOREX") {
                parent = EXCURSION_PARENT
                child = EXCURSION_CHILD
            } else if (pcs.isNotEmpty()) {
                parent = capitalize(clean(pcs[0]["categoryName"])).ifEmpty { "Other" }
                val kids = pcs[0]["childCategory"].arrOrEmpty()
                if (kids.isNotEmpty()) {
                    child = clean(kids[0]["items"].firstIfArray().objOrEmpty()["categoryName"])
                }
            }
            val cat = acc.cats.index(jsonArrayOf(parent, child))
            val loc = p["productLocation"].objOrEmpty()
            val venueName = clean(loc["locationTitle"])
            // By name and code, so a blank title with a code (VINT) is its own venue.
            val venue = acc.venues.index(jsonArrayOf(venueName, loc["locationCode"].let { if (it.truthy()) it else JsonNull }))
            val title = clean(p["productTitle"])
            val minutes = p["productDuration"].objOrEmpty()["durationInMinutes"].let { if (it.truthy()) it else JsonPrimitive(0) }
            val paid = if (kind in PAID_TYPES) 1 else 0
            val price = productPrice(p)
            val age = ageOf(p, title, venueName)
            val notes = notesOf(p, title).map { acc.notes.index(jsonArrayOf(it.first, it.second)) }
            val pid = clean(p["productID"]).ifEmpty { null }
            for (o in p["offering"].arrOrEmpty()) {
                val d = o["offeringDate"].string()
                if (d == null || d.length != 8) continue
                val t = o["offeringTime"].string()
                val date = "${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)}"
                val time = if (t != null && t.length == 4 && t != "0000") "${t.substring(0, 2)}:${t.substring(2, 4)}" else null  // 00:00 = untimed
                val key = listOf(title, date, time ?: "", venue.toString()).joinToString("|")
                if (!acc.seen.add(key)) continue
                val early = earlyOf(p, o)
                val info = if (age != null || early != null || notes.isNotEmpty()) {
                    acc.infos.index(jsonArrayOf(age?.toJson(), early, notes))
                } else null
                val dur = o["offeringDurationInMinutes"].let { if (it.truthy()) it else minutes }
                val featured = p["isFeatured"].truthy() || o["isFeatured"].truthy()
                acc.events += jsonArrayOf(title, venue, cat, date, time, jsParseInt(dur)?.takeIf { it != 0L } ?: 0L,
                    if (featured) 1 else 0, if (p["isReservationRequired"].truthy()) 1 else 0, paid, price, info, pid)
            }
        }
        return products.size
    }

    fun finishSchedule(acc: ScheduleAcc): JsonObject {
        fun s(e: JsonArray, i: Int) = e[i].string() ?: ""
        val events = acc.events.sortedWith(compareBy<JsonArray>({ s(it, 3) }, { s(it, 4) }, { s(it, 0) }))
        return obj {
            bool("published", events.isNotEmpty())
            raw("cats", JsonArray(acc.cats.values))
            raw("venues", JsonArray(acc.venues.values.map { (it as JsonArray)[0] }))
            raw("venueCodes", JsonArray(acc.venues.values.map { (it as JsonArray)[1] }))
            raw("notes", JsonArray(acc.notes.values))
            raw("infos", JsonArray(acc.infos.values))
            raw("fields", JsonArray(FIELDS.map { JsonPrimitive(it) }))
            raw("events", JsonArray(events))
        }
    }

    /** '212 events (53 shore excursion sessions): 23 with age limits, 8 arrive early, 95 with notes'. */
    fun scheduleSummary(sched: JsonElement): String {
        val f = sched["fields"].arrOrEmpty().mapIndexed { i, n -> n.jsString() to i }.toMap()
        val cats = sched["cats"].arrOrEmpty()
        val infos = sched["infos"].arrOrEmpty()
        val events = sched["events"].arrOrEmpty()
        var excursions = 0
        var age = 0
        var early = 0
        var notes = 0
        for (e in events) {
            val c = cats.getOrNull(e.jsonArrayAt(f["cat"]).number()?.toInt() ?: -1).arrOrEmpty()
            if (c.getOrNull(0).string() == EXCURSION_PARENT && c.getOrNull(1).string() == EXCURSION_CHILD) excursions++
            val r = e.jsonArrayAt(f["info"]).number()?.toInt()?.let { infos.getOrNull(it) } ?: continue
            if (r.jsonArrayAt(0).truthy()) age++
            if (r.jsonArrayAt(1) !is JsonNull && r.jsonArrayAt(1) != null) early++
            if (r.jsonArrayAt(2).arrOrEmpty().isNotEmpty()) notes++
        }
        return "${events.size} events ($excursions shore excursion sessions): $age with age limits, $early arrive early, $notes with notes"
    }

    private fun JsonElement?.jsonArrayAt(i: Int?): JsonElement? = if (i == null) null else (this as? JsonArray)?.getOrNull(i)

    // ------------------------------------------------------------ with login

    /** The account id (`sub`) from the token's middle part (base64url JSON). */
    fun accountOf(token: String?): String? {
        val part = (token ?: "").split(".").getOrNull(1) ?: ""
        val chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        var bits = 0
        var value = 0
        val out = StringBuilder()
        for (ch in part) {
            val n = chars.indexOf(ch)
            if (n < 0) continue
            value = ((value shl 6) or n) and 0xFFFFFF
            bits += 6
            if (bits >= 8) {
                bits -= 8
                out.append(((value shr bits) and 255).toChar())
            }
        }
        return try {
            val sub = parseJson(out.toString())["sub"]
            if (sub.truthy()) sub.jsString() else null
        } catch (e: Exception) {
            null
        }
    }

    /** Royal's many time spellings -> 'HH:MM' (24h), or null when it isn't one. */
    fun hhmm(text: JsonElement?): String? {
        val s = clean(text)
        if (s.isEmpty()) return null
        var m = Regex("\\d{4}-?\\d{2}-?\\d{2}[T ](\\d{2}):?(\\d{2})").find(s)
        if (m == null) {
            Regex("(\\d{1,2}):(\\d{2})(?::\\d{2})?\\s*([AaPp])\\.?[Mm]\\.?(\\s.*)?").matchEntire(s)?.let {
                val h12 = it.groupValues[1].toLong() % 12 + if (it.groupValues[3].lowercase() == "p") 12 else 0
                return if (it.groupValues[2].toLong() < 60) pad2(h12) + ":" + it.groupValues[2] else null
            }
            m = Regex("(\\d{1,2}):(\\d{2})(?::\\d{2})?(\\s.*)?").matchEntire(s) ?: Regex("(\\d{2})(\\d{2})(?:[0-5]\\d)?").matchEntire(s)
        }
        if (m == null) return null
        val h = m.groupValues[1].toLong()
        val mi = m.groupValues[2].toLong()
        return if (h < 24 && mi < 60) pad2(h) + ":" + pad2(mi) else null
    }

    fun hhmm(text: String?): String? = hhmm(text?.let { JsonPrimitive(it) })

    /** '2027-03-09T07:00:00' -> ['2027-03-09', '07:00']; [null, null] when unreadable. */
    fun isoParts(text: JsonElement?): Pair<String?, String?> {
        val s = if (text.truthy()) text.jsString() else ""
        val m = Regex("^(\\d{4})-?(\\d{2})-?(\\d{2})[T ](\\d{2}):?(\\d{2})").find(s) ?: return null to null
        val g = m.groupValues
        return "${g[1]}-${g[2]}-${g[3]}" to "${g[4]}:${g[5]}"
    }

    /** Gangway times, approximate coordinates per port day and the embarkation port's time zone. */
    fun parseVoyage(json: JsonElement?): Pair<JsonArray, String?> {
        val info = json["payload"].objOrEmpty()["sailingInfo"].firstIfArray().objOrEmpty()
        val ports = mutableListOf<JsonObject>()
        info["itinerary"].objOrEmpty()["portInfo"].arrOrEmpty().forEach { p ->
            val entry = ObjBuilder()
            entry.raw("day", p["day"])
            entry.raw("code", p["portCode"])
            var n = 0
            for (key in listOf("gangwayDown", "gangwayUp")) {
                val raw = clean(p[key])
                if (raw.isNotEmpty()) {
                    entry.str(key, hhmm(raw) ?: raw)
                    n++
                }
            }
            for (poi in p["pointsOfInterest"].arrOrEmpty()) {
                val lat = poi["latitude"].number()
                val lon = poi["longitude"].number()
                if (lat != null && lon != null && (lat != 0.0 || lon != 0.0)) {
                    entry.num("lat", jsRound(lat * 10000) / 10000)
                    entry.num("lon", jsRound(lon * 10000) / 10000)
                    n++
                    break
                }
            }
            if (n > 0) ports += entry.build()
        }
        return JsonArray(ports) to orNone(info["departurePortInformation"].objOrEmpty()["timeZoneName"])
    }

    /** Meeting time, end time and length of a booked offering from its catalog page (royal.js offeringTimes). */
    fun parseOfferingTimes(json: JsonElement?, offering: JsonElement): JsonObject {
        val detail = json["payload"].objOrEmpty()
        val offers = detail["bookingOfferingData"].objOrEmpty()["offerings"].arrOrEmpty()
        var match = offers.filter { it["id"].truthy() && it["id"] == offering["id"] }
        if (match.isEmpty()) match = offers.filter { it["dateTime"].truthy() && it["dateTime"] == offering["dateTime"] }
        val out = ObjBuilder()
        if (match.isNotEmpty()) {
            val date = isoParts(offering["dateTime"]).first
            for ((from, to) in listOf("meetingTime" to "meet", "endDateTime" to "end")) {
                val dt = isoParts(match[0][from])
                if (dt.second != null && dt.first == date) out.str(to, dt.second)
            }
        }
        val mins = detail["durationInMins"]
        if (mins.isCount() && mins.number()!! > 0) out.raw("minutes", jsNumber(mins.number()!!))
        return out.build()
    }

    /**
     * {[lowercase title, date, time]: {meet, minutes}} from the public shore excursion
     * sessions in a schedule, for booked orders. A session listed twice is left out.
     */
    fun publicExcursionTimes(sched: JsonElement?): Map<List<String>, JsonObject> {
        val out = LinkedHashMap<List<String>, JsonObject>()
        if (sched == null || sched is JsonNull) return out
        val f = sched["fields"].arrOrEmpty().mapIndexed { i, n -> n.jsString() to i }.toMap()
        val fi = f["info"] ?: return out
        val cats = sched["cats"].arrOrEmpty()
        val infos = sched["infos"].arrOrEmpty()
        val seen = HashSet<List<String>>()
        for (e in sched["events"].arrOrEmpty()) {
            val time = e.jsonArrayAt(f["time"])
            val c = cats.getOrNull(e.jsonArrayAt(f["cat"]).number()?.toInt() ?: -1).arrOrEmpty()
            if (!time.truthy() || c.getOrNull(0).string() != EXCURSION_PARENT || c.getOrNull(1).string() != EXCURSION_CHILD) continue
            val key = listOf(e.jsonArrayAt(f["title"]).jsString().lowercase(), e.jsonArrayAt(f["date"]).jsString(), time.jsString())
            if (!seen.add(key)) {
                out.remove(key)
                continue
            }
            val times = ObjBuilder()
            val infoAt = e.jsonArrayAt(fi)
            val info = if (infoAt != null && infoAt !is JsonNull) infos.getOrNull(infoAt.number()?.toInt() ?: -1) else null
            val early = info.jsonArrayAt(1)
            val start = clockMinutes(JsonPrimitive(time.jsString().replace(":", "")))
            if (early.isCount() && start != null && early.number()!! > 0 && early.number()!! <= start) {
                val at = start - early.number()!!.toLong()
                times.str("meet", pad2(at / 60) + ":" + pad2(at % 60))
            }
            val minutes = e.jsonArrayAt(f["minutes"])
            if (minutes.truthy()) times.raw("minutes", minutes)
            out[key] = times.build()
        }
        return out
    }

    /** ' Your account has: HM 2026-12-12, WN 2028-01-01.' (ship and date only); '' with no bookings. */
    fun bookingList(bookings: List<JsonElement>): String {
        val list = bookings.map { b ->
            val d = (if (b["sailDate"].truthy()) b["sailDate"].jsString() else "").replace("-", "")
            (if (b["shipCode"].truthy()) b["shipCode"].jsString() else "?") + " " +
                (if (d.length >= 8) "${d.substring(0, 4)}-${d.substring(4, 6)}-${d.substring(6, 8)}" else "?")
        }.distinct()
        return if (list.isNotEmpty()) " Your account has: " + list.joinToString(", ") + "." else ""
    }

    private fun letters(v: JsonElement?): String = (if (v.truthy()) v.jsString() else "").lowercase().replace(Regex("[^a-z]"), "")
    private fun digits(v: JsonElement?): String = (if (v.truthy()) v.jsString() else "").replace(Regex("[^0-9]"), "")
    private fun or(a: JsonElement?, b: JsonElement?): JsonElement? = if (a.truthy()) a else b

    data class Identity(val first: String, val last: String, val birth: String, val loyalty: String)

    /** The signed-in guest's name, birth date and Crown & Anchor number from the account profile. */
    fun guestIdentity(profile: JsonElement): Identity {
        val info = or(profile["personalInformation"], profile)
        val loyalty = profile["loyaltyInformation"].objOrEmpty()
        return Identity(letters(info["firstName"]), letters(info["lastName"]),
            digits(or(info["birthdate"], info["birthDate"])), digits(loyalty["crownAndAnchorId"]))
    }

    /** Whether the signed-in guest is among the booking's guests. */
    fun sailsOn(booking: JsonElement, me: Identity): Boolean {
        val guests = booking["passengers"].arrOrEmpty() + booking["passengersInStateroom"].arrOrEmpty()
        return guests.any { p ->
            val number = digits(or(p["loyaltyNumber"], p["crownAndAnchorId"]))
            if (me.loyalty.isNotEmpty() && number.isNotEmpty()) return@any number == me.loyalty
            val birth = digits(or(p["birthdate"], p["birthDate"]))
            me.first.isNotEmpty() && me.last.isNotEmpty() && letters(p["firstName"]) == me.first &&
                letters(p["lastName"]) == me.last && !(me.birth.isNotEmpty() && birth.isNotEmpty() && birth != me.birth)
        }
    }

    /** 'booking found: 3 purchases (1 timed), 2 port days', for a log: counts only. */
    fun mineSummary(mine: JsonElement): String {
        val orders = mine["orders"].arrOrEmpty()
        val timed = orders.count { it["time"].truthy() }
        val others = mine["otherBookings"].number()?.toLong() ?: 0
        val ports = mine["ports"] as? JsonArray
        return "booking found: ${orders.size} purchases ($timed timed), " +
            (if (ports != null) "${ports.size} port days" else "port details skipped") +
            (if (mine["ordersError"].truthy()) ", purchases skipped" else "") +
            (if (others > 0) ", $others linked booking${if (others > 1) "s" else ""} on this sailing set aside" +
                (if (mine["bookingUnsure"].truthy()) " (not sure which is yours)" else "") else "")
    }
}
