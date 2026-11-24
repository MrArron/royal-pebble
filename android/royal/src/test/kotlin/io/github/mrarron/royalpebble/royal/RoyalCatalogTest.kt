package io.github.mrarron.royalpebble.royal

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The Cruise Planner product list, read from a made-up reply shaped like Royal's (no real ids or guests). */
class RoyalCatalogTest {
    companion object {
        /** A page of two real-looking products, one more without a type id, and a list-shaped price. */
        val SAMPLE = """
        {"data":{"products":{"__typename":"CommerceProductResultSuccess","commerceProducts":[
          {"id":"AAA1","baseId":"PG-1","title":"Party Package (21+)","type":{"id":"pt_packages","name":"Packages"},
           "price":[{"currency":"USD","promotionalPrice":null,"shipboardPrice":null,"formattedBasePrice":"${'$'}96.99",
                     "formattedPromotionalPrice":null,"formattedDailyPrice":"${'$'}96.99","salesUnit":{"code":"perDay","name":"Per Day","label":"Adult Per Day"}}]},
          {"id":"BBB2","baseId":"PG-2","title":"Soda Package","type":{"id":"pt_beverage","name":"Beverage"},
           "price":[{"currency":"USD","promotionalPrice":"11.99","shipboardPrice":null,"formattedBasePrice":"${'$'}18.00",
                     "formattedPromotionalPrice":"${'$'}11.99","formattedDailyPrice":"${'$'}18.00","salesUnit":{"code":"perNight","name":"Per Night","label":"x"}}]},
          {"id":"CCC3","baseId":"PG-3","title":"No type","type":null,"price":[]}
        ],"pageInfo":{"totalResults":3,"totalPages":1,"hasNextPage":false}}}}
        """.trimIndent()
    }

    @Test
    fun aPageGivesItemsWithTypeIdProductIdAndListedPrice() {
        val page = RoyalCatalog.parsePage(Json.parseToJsonElement(SAMPLE), "Drinks")
        assertEquals(2, page.items.size)  // the product without a type id can't make a link
        assertEquals("pt_packages/AAA1", page.items[0].code)
        assertEquals("${'$'}96.99 per day", page.items[0].price)
        assertEquals("pt_beverage/BBB2", page.items[1].code)
        assertEquals("${'$'}11.99 per night", page.items[1].price)  // promotional price wins
        assertEquals("Drinks", page.items[0].group)
        assertFalse(page.hasNext)
        assertEquals(null, page.error)
    }

    @Test
    fun anExceptionReplyIsAnErrorNotACrash() {
        val reply = Json.parseToJsonElement("""{"data":{"products":{"exceptions":[{}]}}}""")
        val page = RoyalCatalog.parsePage(reply, "Drinks")
        assertTrue(page.items.isEmpty())
        assertNotNull(page.error)
        assertTrue(RoyalCatalog.parsePage(null, "Drinks").items.isEmpty())
    }

    @Test
    fun theRequestAsksForOnePageOf24AsTheGivenGuest() {
        val body = Json.parseToJsonElement(RoyalCatalog.requestBody("beverage", "HM", "2027-03-06", "P1", "R1", 2)).toString()
        assertTrue(body, "\"operationName\":\"WebProductsByCategory\"" in body)
        assertTrue(body, "\"pageSize\":24" in body && "\"currentPage\":2" in body)
        assertTrue(body, "\"category\":\"beverage\"" in body && "\"sailDate\":\"2027-03-06\"" in body)
        assertTrue(body, "\"passengerId\":\"P1\"" in body && "\"reservationId\":\"R1\"" in body)
    }

    @Test
    fun theSavedListRoundTrips() {
        val items = RoyalCatalog.parsePage(Json.parseToJsonElement(SAMPLE), "Drinks").items
        assertEquals(items, RoyalCatalog.decode(RoyalCatalog.encode(items)))
        assertTrue(RoyalCatalog.decode(null).isEmpty())
        assertTrue(RoyalCatalog.decode("not json").isEmpty())
    }
}
