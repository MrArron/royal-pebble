package io.github.mrarron.royalpebble.settings

import io.github.mrarron.royalpebble.store.CruiseStore
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.time.LocalDate
import java.time.LocalDateTime

/**
 * Demo mode: a made-up cruise built around the current time (a port day or a
 * sea day), shown on the settings screens until real cruise data is saved, so
 * every screen has something to try. A port of `src/pkjs/demo.js` without its
 * watch alert-test variants. It is an ordinary bundle (docs/DATA_FORMAT.md) and
 * is never written to the [CruiseStore]; the owner's settings are.
 *
 * The cabin is made up (9254), as in the JS demo.
 */
object DemoBundle {
    class Demo(val bundle: JsonObject, val settings: JsonObject, val stars: Map<String, Boolean>)

    private val CATS = listOf(
        "Entertainment" to "Shows", "Activities" to "Games & Trivia", "Shop" to "Retail",
        "Activities" to "Fitness", "Entertainment" to "Music & Dance",
    )

    // title, venue, cat, offset minutes from the base time (null = untimed), minutes, featured, reservation, starred, reserved
    private class Row(val title: String, val venue: String, val cat: Int, val at: Int?, val minutes: Int,
                      val featured: Int, val reservation: Int, val starred: Int, val reserved: Int = 0)

    private val PORT_EVENTS = listOf(
        Row("Scavenger Hunt Sheets", "Guest Services", 1, null, 0, 0, 0, 0),
        Row("Sunrise Stretch", "Solarium", 3, -150, 30, 0, 0, 0),
        Row("Bingo", "Studio B", 1, -45, 60, 0, 0, 0),
        Row("Adventure Ocean Open House", "Deck 14", 1, -30, 60, 0, 0, 0),
        Row("Trivia: Movie Quotes", "Music Hall", 1, 30, 45, 0, 0, 0),
        Row("Salsa Lesson", "Boleros", 4, 30, 30, 0, 0, 0),
        Row("Watch Sale", "Regalia Watches", 2, 60, 120, 0, 0, 0),
        Row("Welcome Back Aboard Party", "Pool Deck", 4, 90, 60, 1, 0, 0),
        Row("HiRO", "AquaTheater", 0, 180, 45, 1, 1, 1),
        Row("Shuffleboard Tournament", "Sports Court", 1, 180, 45, 0, 0, 0),
        Row("Big Band Music With the Harmony of the Seas Orchestra", "Royal Promenade", 4, 240, 45, 0, 0, 0),
        Row("Adult Comedy", "Comedy Live", 0, 300, 60, 0, 1, 0),
    )

    private val SEA_EVENTS = listOf(
        Row("Scavenger Hunt Sheets", "Guest Services", 1, null, 0, 0, 0, 0),
        Row("Morning Walk-a-thon", "Running Track", 3, -120, 45, 0, 0, 0),
        Row("Art Auction Preview", "Art Gallery", 1, -30, 90, 0, 0, 0),
        Row("Pool Games", "Pool Deck", 1, -15, 45, 0, 0, 0),
        Row("Sail Away Karaoke Party", "On Air", 4, 20, 45, 0, 0, 0),
        Row("Ice Show: 1887", "Studio B", 0, 60, 60, 1, 1, 1),
        Row("Towel Folding Demo", "Royal Promenade", 1, 60, 30, 0, 0, 0),
        Row("Jewelry Blowout", "Royal Promenade", 2, 90, 120, 0, 0, 0),
        Row("Name That Tune", "Music Hall", 1, 120, 45, 0, 0, 0),
        Row("Mamma Mia!", "Royal Theater", 0, 240, 120, 1, 1, 1, 1),
        Row("Silent Disco", "Boardwalk", 4, 330, 90, 0, 0, 0),
    )

    private val NOTES = listOf(
        "kbyg/general/seapass" to "Please bring your SeaPass",
        "kbyg/general/WEATHER" to "Weather permitting",
    )

    /** The demo for [now]; [port] picks a port day (with a booked excursion) over a sea day. */
    fun make(now: LocalDateTime, port: Boolean = true): Demo {
        var today = now.toLocalDate()
        var nowMin = now.hour * 60 + now.minute
        // The demo's "today" is the watch day containing now (days start at 04:00).
        if (nowMin < DAY_START) {
            today = today.minusDays(1)
            nowMin += 24 * 60
        }
        val sail = today.minusDays(1)
        fun d(date: LocalDate) = date.toString()
        fun hhmm(m: Int) = CruiseData.hhmm(m)

        // All-aboard about 2 h 13 min from now, as the JS demo; none once past the watch day's end.
        val departMin = nowMin + 133 + 30
        val depart = if (departMin < 24 * 60 + DAY_START) hhmm(departMin % (24 * 60)) else null

        fun day(n: Int, date: LocalDate, portName: String, code: String, type: String, arrive: String?, dep: String?) =
            JsonObject(linkedMapOf(
                "day" to JsonPrimitive(n), "date" to JsonPrimitive(d(date)), "port" to JsonPrimitive(portName),
                "code" to JsonPrimitive(code), "type" to JsonPrimitive(type),
                "arrive" to (arrive?.let { JsonPrimitive(it) } ?: JsonNull),
                "depart" to (dep?.let { JsonPrimitive(it) } ?: JsonNull),
            ))

        val itinerary = listOf(
            day(1, sail, "Orlando (Port Canaveral), Fl", "PCN", "EMBARK", null, "16:00"),
            if (port) day(2, today, "St. Thomas, U.S. Virgin Islands", "STT", "DOCKED",
                hhmm(maxOf(nowMin - 180, DAY_START) % (24 * 60)), depart)
            else day(2, today, "Cruising", "CRU", "CRUISING", null, null),
            day(3, sail.plusDays(2), "Nassau, Bahamas", "NAS", "DOCKED", "07:30", "17:30"),
            day(4, sail.plusDays(3), "Orlando (Port Canaveral), Fl", "PCN", "DEBARK", "06:00", null),
        )

        val base = maxOf(nowMin - nowMin % 15, DAY_START + 180)
        val venues = ArrayList<String>()
        val stars = LinkedHashMap<String, Boolean>()
        val events = ArrayList<JsonElement>()
        fun venueIndex(v: String): Int { if (v !in venues) venues += v; return venues.indexOf(v) }
        fun add(title: String, venue: String, cat: Int, date: LocalDate, time: String?, minutes: Int, featured: Int,
                reservation: Int, info: Int?) {
            events.add(JsonArray(listOf(
                JsonPrimitive(title), JsonPrimitive(venueIndex(venue)), JsonPrimitive(cat), JsonPrimitive(d(date)),
                time?.let { JsonPrimitive(it) } ?: JsonNull, JsonPrimitive(minutes), JsonPrimitive(featured),
                JsonPrimitive(reservation), info?.let { JsonPrimitive(it) } ?: JsonNull,
            )))
        }
        for (e in if (port) PORT_EVENTS else SEA_EVENTS) {
            // Like Royal, after-midnight times stay under today's (the evening's) date.
            val time = e.at?.let { hhmm((base + it) % (24 * 60)) }
            add(e.title, e.venue, e.cat, today, time, e.minutes, e.featured, e.reservation, null)
            val key = CruiseStore.starKey(e.title, d(today), time, e.venue)
            if (e.starred == 1) stars[key] = true
            if (e.reserved == 1) stars[CruiseStore.RESERVED_PREFIX + key] = true
        }
        val tomorrow = today.plusDays(1)
        add("Sunrise Pilates", "Solarium", 3, tomorrow, "08:30", 45, 0, 0, null)
        stars[CruiseStore.starKey("Sunrise Pilates", d(tomorrow), "08:30", "Solarium")] = true
        add("Mamma Mia!", "Royal Theater", 0, tomorrow, "20:00", 120, 1, 1, null)

        val schedule = JsonObject(linkedMapOf(
            "published" to JsonPrimitive(true),
            "cats" to JsonArray(CATS.map { JsonArray(listOf(JsonPrimitive(it.first), JsonPrimitive(it.second))) }),
            "venues" to JsonArray(venues.map { JsonPrimitive(it) }),
            "notes" to JsonArray(NOTES.map { JsonArray(listOf(JsonPrimitive(it.first), JsonPrimitive(it.second))) }),
            "infos" to JsonArray(emptyList()),
            "fields" to JsonArray(listOf("title", "venue", "cat", "date", "time", "minutes", "featured", "reservation", "info")
                .map { JsonPrimitive(it) }),
            "events" to JsonArray(events),
        ))
        val bundle = LinkedHashMap<String, JsonElement>()
        bundle["format"] = JsonPrimitive("cruise-watch")
        bundle["v"] = JsonPrimitive(1)
        bundle["generated"] = JsonPrimitive(now.minusHours(3).toString())
        bundle["ship"] = JsonObject(linkedMapOf("code" to JsonPrimitive("HM"), "name" to JsonPrimitive("Harmony of the Seas")))
        bundle["sailDate"] = JsonPrimitive(d(sail))
        bundle["itinerary"] = JsonArray(itinerary)
        bundle["schedule"] = schedule
        if (port) {
            // A booked excursion an hour out (meet 15 minutes before) and a package, which never shows.
            val exc = base + 60
            bundle["mine"] = JsonObject(linkedMapOf(
                "stateroom" to JsonPrimitive("9254"),
                "orders" to JsonArray(listOf(
                    JsonObject(linkedMapOf(
                        "title" to JsonPrimitive("Island Snorkel & Beach Tour"), "category" to JsonPrimitive("pt_shoreX"),
                        "guests" to JsonPrimitive(2), "date" to JsonPrimitive(d(today)),
                        "time" to JsonPrimitive(hhmm(exc % (24 * 60))), "day" to JsonPrimitive(2),
                        "port" to JsonPrimitive("STT"), "meet" to JsonPrimitive(hhmm((exc - 15) % (24 * 60))),
                        "end" to JsonPrimitive(hhmm((exc + 150) % (24 * 60))), "minutes" to JsonPrimitive(150),
                    )),
                    JsonObject(linkedMapOf("title" to JsonPrimitive("Deluxe Beverage Package"),
                        "category" to JsonPrimitive("pt_beverage"), "guests" to JsonPrimitive(2))),
                )),
            ))
        }
        val dinner = base + (if (port) 150 else 180)
        val settings = JsonObject(linkedMapOf(
            "theme" to JsonPrimitive("light"),
            "showFeatured" to JsonPrimitive(true),
            "days" to JsonObject(emptyMap()),
            "personal" to SettingsRules.personalJson(listOf(SettingsRules.Personal(
                "Dinner", "Main Dining", d(today), hhmm(dinner % (24 * 60)), 90))),
            "me" to JsonObject(linkedMapOf(
                "stateroom" to JsonPrimitive("9254"), "deck" to JsonPrimitive("Deck 9"),
                "stairs" to JsonPrimitive("Fwd stairs"), "muster" to JsonPrimitive("B4 - Royal Promenade"),
                "dining" to JsonPrimitive("Main Dining Room 4"),
            )),
        ))
        return Demo(JsonObject(bundle), settings, stars)
    }
}
