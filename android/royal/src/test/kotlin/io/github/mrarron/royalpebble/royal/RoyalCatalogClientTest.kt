package io.github.mrarron.royalpebble.royal

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** fetchCatalog against a fake Royal: made-up booking, ids and products. */
class RoyalCatalogClientTest {
    private val sleeps = mutableListOf<Long>()
    private val posts = mutableListOf<HttpRequest>()

    private fun product(id: String, type: String, title: String) =
        """{"id":"$id","title":"$title","type":{"id":"$type"},"price":[{"formattedBasePrice":"${'$'}10.00","salesUnit":{"code":"perSeat"}}]}"""

    private fun page(vararg products: String, next: Boolean = false) =
        """{"data":{"products":{"commerceProducts":[${products.joinToString(",")}],"pageInfo":{"hasNextPage":$next}}}}"""

    private val bookings = """{"payload":{"profileBookings":[
        {"shipCode":"HM","sailDate":"2027-03-06","passengerId":"P1","bookingId":"R1"}]}}"""

    /** [answer] gets the category and page of each product request. */
    private fun client(answer: (String, Int) -> HttpResponse): RoyalClient = RoyalClient({ req ->
        if (req.method == "POST") {
            posts += req
            val body = req.body!!
            val cat = Regex("\"category\":\"(\\w+)\"").find(body)!!.groupValues[1]
            val pg = Regex("\"currentPage\":(\\d+)").find(body)!!.groupValues[1].toInt()
            answer(cat, pg)
        } else HttpResponse(200, bookings)
    }, sleep = { sleeps += it })

    @Test
    fun readsEveryCategoryPagesAndKeepsAProductOnce() {
        val result = client { cat, pg ->
            HttpResponse(200, when {
                cat == "beverage" && pg == 0 -> page(product("A1", "pt_packages", "Drinks A"), next = true)
                cat == "beverage" && pg == 1 -> page(product("A2", "pt_beverage", "Drinks B"))
                cat == "internet" -> page(product("A1", "pt_packages", "Drinks A"), product("N1", "pt_internet", "Internet"))
                else -> page(product("$cat-1", "pt_$cat", "Item $cat"))
            })
        }.fetchCatalog(RoyalAuth("t", "ACC1"), "HM", "20270306")
        assertEquals(emptyList<String>(), result.failed)
        val codes = result.items.map { it.code }
        assertEquals(1, codes.count { it == "pt_packages/A1" })  // listed under two categories, kept once
        assertTrue("pt_beverage/A2" in codes && "pt_internet/N1" in codes && "pt_spa/spa-1" in codes)
        assertEquals("Drinks", result.items.first { it.code == "pt_beverage/A2" }.group)
        // beverage twice (two pages) + four more categories
        assertEquals(6, posts.size)
        assertEquals(5, sleeps.size)  // a pause before every request after the first
        assertTrue(sleeps.all { it == 1500L })
        posts.forEach {
            assertEquals("t", it.headers["Access-Token"])
            assertEquals("application/json", it.headers["Content-Type"])
            assertTrue("P1" in it.body!! && "R1" in it.body!!)
        }
    }

    @Test
    fun aFailingCategoryIsSkippedAndNamed() {
        val result = client { cat, _ ->
            if (cat == "dining") HttpResponse(200, """{"data":{"products":{"exceptions":[{}]}}}""")
            else if (cat == "spa") HttpResponse(500, "{}")
            else HttpResponse(200, page(product("$cat-1", "pt_$cat", "Item $cat")))
        }.fetchCatalog(RoyalAuth("t", "ACC1"), "HM", "20270306")
        assertEquals(listOf("Dining", "Spa"), result.failed)
        assertEquals(3, result.items.size)
        assertFalse(result.items.any { it.code.contains("dining") })
    }

    @Test
    fun noBookingOnThatSailingIsAnError() {
        val c = RoyalClient({ HttpResponse(200, """{"payload":{"profileBookings":[]}}""") }, sleep = { })
        try {
            c.fetchCatalog(RoyalAuth("t", "ACC1"), "HM", "20270306")
            error("no exception")
        } catch (e: RoyalException) {
            assertTrue(e.message!!.startsWith("Signed in, but found no booking"))
        }
    }

    @Test
    fun aDownloadWithLoginCanLoadThePlannerListOnTheSameSignIn() {
        val fake = FakeRoyal(replies = mapOf("/graphql" to page(product("A1", "pt_packages", "Drinks A"))))
        val got = RoyalClient(fake, sleep = { }).downloadWithLogin(RoyalParse.Ship("HM", "Harmony of the Seas"), "2027-03-06", "me@example.com", "pw", catalog = true)
        assertEquals(1, fake.calls.count { it.path.endsWith("oauth2/access_token") })  // one sign-in for everything
        assertTrue(got.bundle.containsKey("mine"))
        assertEquals(null, got.catalogError)
        assertTrue(got.catalog!!.items.any { it.code == "pt_packages/A1" })
        // Not asked for: no planner requests at all.
        val plain = FakeRoyal()
        val without = RoyalClient(plain, sleep = { }).downloadWithLogin(RoyalParse.Ship("HM", "Harmony of the Seas"), "2027-03-06", "me@example.com", "pw")
        assertEquals(null, without.catalog)
        assertEquals(0, plain.calls.count { it.path.endsWith("/graphql") })
    }
}
