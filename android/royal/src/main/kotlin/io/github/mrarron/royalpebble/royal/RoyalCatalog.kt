package io.github.mrarron.royalpebble.royal

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement

/**
 * One Cruise Planner product from Royal's own product list (the planner's `WebProductsByCategory`
 * GraphQL call, captured 2026-11-24): what a price watch needs without a pasted link.
 * [prefix] is the product's Cruise Planner type id (`pt_packages`, `pt_beverage`, `pt_internet`,
 * `pt_onboardActivities`, `pt_spa`...), [product] its id; together they are the link's
 * `/category/{prefix}/product/{product}`. [price] is Royal's listed price text, for display only.
 */
data class CatalogItem(
    val prefix: String,
    val product: String,
    val title: String,
    /** Our label for where it was listed (Drinks, Internet, Dining, Activities, Spa). */
    val group: String,
    /** e.g. "$96.99 per day", or blank when Royal listed none. */
    val price: String,
) {
    val code: String get() = "$prefix/$product"
}

/** A page of the product list: its items, whether more follow, and Royal's complaint when it had one. */
data class CatalogPage(val items: List<CatalogItem>, val hasNext: Boolean, val error: String? = null)

object RoyalCatalog {
    /** Planner category name to our label. Shore excursions come from the downloaded schedule instead. */
    val CATEGORIES: List<Pair<String, String>> = listOf(
        "beverage" to "Drinks",
        "internet" to "Internet",
        "dining" to "Dining",
        "activities" to "Activities",
        "spa" to "Spa",
    )

    /** Royal rejects a bigger page ("pageSize must be less than or equal to 24"). */
    const val PAGE_SIZE = 24

    /** Pages read per category, so a long category (spa lists over 100) stays a few requests. */
    const val MAX_PAGES = 6

    const val ERR_NO_PRODUCTS = "Royal Caribbean listed no products for this category."

    private const val QUERY = """query WebProductsByCategory(${'$'}category: String!, ${'$'}passengerId: String, ${'$'}shipCode: ShipCodeScalar!, ${'$'}sailDate: LocalDateScalar!, ${'$'}reservationId: String, ${'$'}pageSize: Long, ${'$'}currentPage: Long, ${'$'}sorting: Sorting, ${'$'}filter: FilterInput, ${'$'}currencyCode: String!) {
  products(category: ${'$'}category guestTypes: [ADULT] passengerId: ${'$'}passengerId shipCode: ${'$'}shipCode sailDate: ${'$'}sailDate reservationId: ${'$'}reservationId pageSize: ${'$'}pageSize currentPage: ${'$'}currentPage sorting: ${'$'}sorting filter: ${'$'}filter currencyIso: ${'$'}currencyCode) {
    ... on CommerceProductResultSuccess { __typename commerceProducts { id baseId title type { id name }
      price { currency promotionalPrice shipboardPrice formattedBasePrice formattedPromotionalPrice formattedDailyPrice salesUnit { code name label } } }
      pageInfo { totalResults totalPages hasNextPage } }
    ... on CommerceProductExceptions { exceptions { ... on InvalidCategoryException { exceptionType message code title } } }
  } }"""

    /** The POST body for one page ([page] counts from 0). [sailDate] is 'YYYY-MM-DD'. */
    fun requestBody(category: String, ship: String, sailDate: String, passengerId: String, reservationId: String, page: Int): String =
        obj {
            str("operationName", "WebProductsByCategory")
            str("query", QUERY)
            raw("variables", obj {
                str("category", category)
                str("passengerId", passengerId)
                str("reservationId", reservationId)
                str("shipCode", ship)
                str("sailDate", sailDate)
                num("pageSize", PAGE_SIZE)
                num("currentPage", page)
                raw("sorting", obj { str("sortKey", "RANK"); str("sortKeyOrder", "ASCENDING") })
                str("currencyCode", "USD")
                raw("filter", obj { bool("includeVariantProducts", false) })
            })
        }.toString()

    /** Reads one reply. A product without an id or type id can't make a link, so it is left out. */
    fun parsePage(reply: JsonElement?, group: String): CatalogPage {
        val products = reply["data"].objOrEmpty()["products"].objOrEmpty()
        val list = products["commerceProducts"] as? JsonArray
            ?: return CatalogPage(emptyList(), false, ERR_NO_PRODUCTS)
        val items = list.mapNotNull { p ->
            val id = p["id"].string()?.trim().orEmpty()
            val type = p["type"]["id"].string()?.trim().orEmpty()
            val title = p["title"].string()?.trim().orEmpty()
            if (id.isEmpty() || type.isEmpty() || title.isEmpty()) null
            else CatalogItem(type, id, title, group, priceText(p["price"]))
        }
        return CatalogPage(items, products["pageInfo"].objOrEmpty()["hasNextPage"].truthy())
    }

    /** "$96.99 per day": the promotional price when there is one, else the base price. `price` is a list. */
    internal fun priceText(price: JsonElement?): String {
        val p = price.firstIfArray().objOrEmpty()
        val amount = listOf("formattedPromotionalPrice", "formattedBasePrice").firstNotNullOfOrNull { k ->
            p[k].string()?.trim()?.takeIf { it.isNotEmpty() }
        } ?: return ""
        val unit = when (p["salesUnit"].objOrEmpty()["code"].string()) {
            "perDay" -> " per day"
            "perNight" -> " per night"
            "perSeat" -> " per guest"
            "perPackage" -> " per package"
            else -> ""
        }
        return amount + unit
    }

    // ------------------------------------------------------------ the saved list

    fun encode(items: List<CatalogItem>): String =
        JsonArray(items.map {
            obj { str("p", it.prefix); str("i", it.product); str("t", it.title); str("g", it.group); str("m", it.price) }
        }).toString()

    fun decode(text: String?): List<CatalogItem> {
        if (text.isNullOrBlank()) return emptyList()
        val arr = try { Json.parseToJsonElement(text) as? JsonArray } catch (e: Exception) { null } ?: return emptyList()
        return arr.mapNotNull { o ->
            val p = o["p"].string(); val i = o["i"].string(); val t = o["t"].string()
            if (p.isNullOrEmpty() || i.isNullOrEmpty() || t.isNullOrEmpty()) null
            else CatalogItem(p, i, t, o["g"].string().orEmpty(), o["m"].string().orEmpty())
        }
    }
}
