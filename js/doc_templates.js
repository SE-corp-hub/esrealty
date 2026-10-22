/* Document templates for deals (backend roadmap J5). Pure and dependency-free; the browser gets
 * window.ESREALTY_DOCS, Node gets module.exports (tests/phase11_node.js).
 *
 * Three starter documents, filled from the deal and the signed-in broker: an offer to buy (letter
 * of intent), a reservation agreement and an exclusive authority to sell. They are plain starting
 * points written for this office, not legal advice: the app tells the user to have a lawyer
 * review them before use. Anything not known is left as a blank line to fill in by hand. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ESREALTY_DOCS = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var FIELDS = [
    ["date", "Date"],
    ["buyer_name", "Buyer"], ["buyer_address", "Buyer's address"],
    ["seller_name", "Seller / owner"], ["seller_address", "Seller's address"],
    ["property", "Property"], ["property_address", "Property address"], ["title_no", "Title no. (TCT / CCT)"],
    ["lot_area", "Lot area (sqm)"], ["floor_area", "Floor area (sqm)"],
    ["price", "Price"], ["price_words", "Price in words"],
    ["reservation_fee", "Reservation fee"], ["reservation_date", "Reservation date"],
    ["offer_valid_days", "Offer valid for (days)"], ["payment_terms", "Payment terms"],
    ["commission_pct", "Commission (%)"], ["authority_days", "Authority period (days)"],
    ["broker_name", "Broker"], ["broker_prc", "Broker PRC licence no."], ["agency", "Brokerage"], ["agent_name", "Agent"]
  ];
  var LABEL = {};
  FIELDS.forEach(function (f) { LABEL[f[0]] = f[1]; });

  var TEMPLATES = [
    {
      id: "offer", title: "Offer to buy (letter of intent)",
      uses: ["date", "buyer_name", "buyer_address", "seller_name", "property", "property_address", "title_no", "price", "price_words", "payment_terms", "offer_valid_days", "agent_name", "agency"],
      body: [
        "{{date}}",
        "",
        "To: {{seller_name}}",
        "",
        "LETTER OF INTENT TO PURCHASE",
        "",
        "I, {{buyer_name}}, of {{buyer_address}}, offer to buy the property described below:",
        "",
        "Property: {{property}}",
        "Location: {{property_address}}",
        "Title no.: {{title_no}}",
        "",
        "Offered price: {{price}} ({{price_words}})",
        "Payment terms: {{payment_terms}}",
        "",
        "This offer is valid for {{offer_valid_days}} days from the date above. It becomes binding only when a contract to sell or deed of sale is signed by both parties. I understand the taxes and fees of the sale will be shared as agreed in that contract.",
        "",
        "This offer is made through {{agent_name}} of {{agency}}.",
        "",
        "",
        "______________________________          ______________________________",
        "{{buyer_name}}                          Accepted by: {{seller_name}}",
        "Buyer                                   Seller / owner          Date: __________"
      ]
    },
    {
      id: "reservation", title: "Reservation agreement",
      uses: ["date", "buyer_name", "buyer_address", "seller_name", "property", "property_address", "title_no", "price", "price_words", "reservation_fee", "reservation_date", "payment_terms", "agent_name", "agency"],
      body: [
        "RESERVATION AGREEMENT",
        "",
        "Date: {{date}}",
        "",
        "Buyer: {{buyer_name}}, of {{buyer_address}}",
        "Seller / owner: {{seller_name}}",
        "",
        "1. Property. The buyer reserves {{property}}, located at {{property_address}}, title no. {{title_no}}.",
        "2. Price. The agreed price is {{price}} ({{price_words}}), payable as follows: {{payment_terms}}.",
        "3. Reservation fee. The buyer paid {{reservation_fee}} on {{reservation_date}}. It forms part of the price when the sale goes through.",
        "4. Holding period. While this reservation is in force the seller will not sell or reserve the property to anyone else.",
        "5. If the sale does not go through. The parties will settle what happens to the reservation fee as follows: ______________________________________________.",
        "6. Next step. The parties will sign a contract to sell or deed of sale, with the documents and payments listed there.",
        "",
        "Handled by {{agent_name}} of {{agency}}.",
        "",
        "",
        "______________________________          ______________________________",
        "{{buyer_name}}                          {{seller_name}}",
        "Buyer                                   Seller / owner",
        "",
        "Witnesses: ______________________________   ______________________________"
      ]
    },
    {
      id: "authority", title: "Exclusive authority to sell",
      uses: ["date", "seller_name", "seller_address", "property", "property_address", "title_no", "lot_area", "floor_area", "price", "price_words", "commission_pct", "authority_days", "broker_name", "broker_prc", "agency"],
      body: [
        "EXCLUSIVE AUTHORITY TO SELL",
        "",
        "Date: {{date}}",
        "",
        "I, {{seller_name}}, of {{seller_address}}, the owner of the property below, give {{broker_name}} (PRC licence no. {{broker_prc}}) of {{agency}} the exclusive authority to market and sell it:",
        "",
        "Property: {{property}}",
        "Location: {{property_address}}",
        "Title no.: {{title_no}}   Lot area: {{lot_area}} sqm   Floor area: {{floor_area}} sqm",
        "Asking price: {{price}} ({{price_words}})",
        "",
        "1. Period. This authority runs for {{authority_days}} days from the date above.",
        "2. Commission. On a sale to a buyer introduced during this period, I will pay a commission of {{commission_pct}}% of the selling price.",
        "3. Exclusivity. During this period I will refer every inquiry to the broker and will not appoint another broker for this property.",
        "4. Marketing. The broker may advertise the property, show it to buyers by appointment and share its details with partner brokers.",
        "5. Documents. I confirm I own the property or am authorised to sell it, and I will provide the title and tax documents the sale needs.",
        "",
        "",
        "______________________________          ______________________________",
        "{{seller_name}}                         {{broker_name}}",
        "Owner                                   Broker, PRC licence no. {{broker_prc}}"
      ]
    }
  ];

  var BLANK = "____________";
  function find(id) { for (var i = 0; i < TEMPLATES.length; i++) if (TEMPLATES[i].id === id) return TEMPLATES[i]; return null; }
  function clean(v) { return v == null ? "" : String(v).trim(); }

  // The template text with every {{field}} replaced; unknown or empty fields become a blank line.
  function fill(id, data) {
    var t = find(id);
    if (!t) return "";
    data = data || {};
    return t.body.join("\n").replace(/\{\{([a-z_]+)\}\}/g, function (m, k) { var v = clean(data[k]); return v || BLANK; });
  }
  // Fields the template uses that are still empty.
  function missing(id, data) {
    var t = find(id);
    if (!t) return [];
    data = data || {};
    return t.uses.filter(function (k) { return !clean(data[k]); }).map(function (k) { return { key: k, label: LABEL[k] || k }; });
  }

  return { FIELDS: FIELDS, TEMPLATES: TEMPLATES, LABEL: LABEL, BLANK: BLANK, find: find, fill: fill, missing: missing };
});
