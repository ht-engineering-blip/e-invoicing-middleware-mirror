import { generateRandomString } from "../../../../@lib";

export function generateDatestamp(date: Date = new Date()): string {
  date = new Date(date);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export function sanitizeIRN(irn: string): string {
  if (typeof irn !== "string") return irn;
  return irn
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9-]/g, "");
}

export function sanitizeInvoiceIRNs(invoice: any): void {
  if (!invoice) return;

  if (invoice.irn) {
    invoice.irn = sanitizeIRN(invoice.irn);
  }

  if (Array.isArray(invoice.billing_reference)) {
    for (const ref of invoice.billing_reference) {
      if (ref && ref.irn) ref.irn = sanitizeIRN(ref.irn);
    }
  }

  if (
    invoice.dispatch_document_reference &&
    invoice.dispatch_document_reference.irn
  ) {
    invoice.dispatch_document_reference.irn = sanitizeIRN(
      invoice.dispatch_document_reference.irn,
    );
  }

  if (
    invoice.receipt_document_reference &&
    invoice.receipt_document_reference.irn
  ) {
    invoice.receipt_document_reference.irn = sanitizeIRN(
      invoice.receipt_document_reference.irn,
    );
  }

  if (
    invoice.originator_document_reference &&
    invoice.originator_document_reference.irn
  ) {
    invoice.originator_document_reference.irn = sanitizeIRN(
      invoice.originator_document_reference.irn,
    );
  }

  if (
    invoice.contract_document_reference &&
    invoice.contract_document_reference.irn
  ) {
    invoice.contract_document_reference.irn = sanitizeIRN(
      invoice.contract_document_reference.irn,
    );
  }

  if (Array.isArray(invoice.additional_document_reference)) {
    for (const ref of invoice.additional_document_reference) {
      if (ref && ref.irn) ref.irn = sanitizeIRN(ref.irn);
    }
  }
}

/**
 * Sanitize an HSN code to the FIRS-required format: digits + "." + exactly 2 decimal digits.
 * Handles: pure digits ("8517" → "8517.00"), missing decimals ("8517." → "8517.00"),
 * single decimal ("8517.1" → "8517.10"), extra decimals ("8517.123" → "8517.12"),
 * and non-digit characters. Returns undefined for empty/invalid input so the field
 * stays optional.
 */
export function sanitizeHsnCode(val: any): string | undefined {
  if (val === undefined || val === null) return undefined;
  let str = String(val).trim();
  if (!str) return undefined;

  // If it has letters, treat it as a custom/non-numeric HSN code and don't sanitize/format it
  if (/[a-zA-Z]/.test(str)) {
    return undefined;
  }

  // Strip any non-digit/non-dot characters
  str = str.replace(/[^\d.]/g, "");
  if (!str || str === ".") return undefined;

  // Pure digits → append .00
  if (/^\d+$/.test(str)) return `${str}.00`;
  // Trailing dot, no decimals → append 00
  if (/^\d+\.$/.test(str)) return `${str}00`;
  // One decimal digit → append 0
  if (/^\d+\.\d$/.test(str)) return `${str}0`;
  // Already valid → return as-is
  if (/^\d+\.\d{2}$/.test(str)) return str;
  // More than 2 decimal digits → truncate to 2
  const match = str.match(/^(\d+\.\d{2})/);
  if (match) return match[1];

  return "0000.00";
}

/**
 * UN/ECE Recommendation 20 — common unit codes used in UBL invoicing.
 * price_unit MUST be one of these UN/ECE codes, NOT a currency code or free text.
 *
 * Reference: https://docs.peppol.eu/poacc/billing/3.0/codelist/UNECERec20/
 */
const VALID_PRICE_UNITS = new Set([
  "H87", // Piece (default for most goods)
  "XBG", // Bag
  "XBX", // Box
  "XCT", // Carton
  "XCS", // Case
  "XDR", // Drum
  "XBK", // Basket
  "XPX", // Pallet
  "XSA", // Sack
  "XTN", // Tin
  "XJR", // Jar
  "TNE", // Tonne (metric ton)
  "KGM", // Kilogram
  "GRM", // Gram
  "MGM", // Milligram
  "LTR", // Litre
  "MLT", // Millilitre
  "MTR", // Metre
  "CMT", // Centimetre
  "MMT", // Millimetre
  "MTK", // Square metre
  "MTQ", // Cubic metre
  "SET", // Set
  "PR", // Pair
  "DZN", // Dozen
  "RL", // Roll
  "RM", // Ream
  "SHT", // Sheet
]);

/**
 * Map common free-text / currency-style price_unit values produced by LLMs
 * to their correct UN/ECE unit codes.
 *
 * Problem: LLMs often write "NGN per 1", "NGN", "pieces", "kg" etc.
 * Solution: detect these and replace with the correct UN/ECE code.
 *
 * Returns "H87" (piece) as the safe default when no match is found.
 */
export function sanitizePriceUnit(val: any): string {
  if (!val || typeof val !== "string") return "H87";
  const s = val.trim().toUpperCase();

  // Already a valid UN/ECE code — return as-is
  if (VALID_PRICE_UNITS.has(s)) return s;

  // Strip trailing / per-X patterns: "NGN per 1", "NGN/1", "NGN PER UNIT", etc.
  const base = s.replace(/\s*(PER|\/)\s*[\d\w]+.*$/, "").trim();
  if (VALID_PRICE_UNITS.has(base)) return base;

  // Currency codes — LLM used currency instead of unit code; default to H87
  const CURRENCY_CODES = new Set([
    "NGN",
    "USD",
    "GBP",
    "EUR",
    "GHS",
    "KES",
    "ZAR",
    "XOF",
    "XAF",
    "CAD",
    "AUD",
    "JPY",
    "CNY",
    "INR",
    "AED",
    "SAR",
    "ZMW",
    "UGX",
  ]);
  if (CURRENCY_CODES.has(base) || CURRENCY_CODES.has(s)) return "H87";

  // Keyword → UN/ECE mapping for common free-text variations
  const lower = s.toLowerCase();
  if (/bag|bags/.test(lower)) return "XBG";
  if (/box|boxes/.test(lower)) return "XBX";
  if (/carton|cartons/.test(lower)) return "XCT";
  if (/case|cases/.test(lower)) return "XCS";
  if (/drum|drums/.test(lower)) return "XDR";
  if (/sack|sacks/.test(lower)) return "XSA";
  if (/pallet|pallets/.test(lower)) return "XPX";
  if (/tonne|ton\b|tonnes|mt\b/.test(lower)) return "TNE";
  if (/kg|kilogram|kilograms/.test(lower)) return "KGM";
  if (/g\b|gram|grams/.test(lower)) return "GRM";
  if (/litre|liter|litres|liters|l\b/.test(lower)) return "LTR";
  if (/ml|millilitre|milliliter/.test(lower)) return "MLT";
  if (/m\b|metre|meter|metres|meters/.test(lower)) return "MTR";
  if (/cm|centimetre|centimeter/.test(lower)) return "CMT";
  if (/sqm|sq\.?\s*m|square\s*m/.test(lower)) return "MTK";
  if (/cbm|m3|cubic\s*m/.test(lower)) return "MTQ";
  if (/dozen|doz/.test(lower)) return "DZN";
  if (/pair|pairs/.test(lower)) return "PR";
  if (/roll|rolls/.test(lower)) return "RL";
  if (/ream|reams/.test(lower)) return "RM";
  if (/sheet|sheets/.test(lower)) return "SHT";
  if (/set|sets/.test(lower)) return "SET";
  if (/piece|pieces|pcs|unit|units|each|ea\b|no\b|number/.test(lower))
    return "H87";

  // Safe default: H87 = piece
  return "H87";
}

/**
 * WCO Harmonized System (HS) standard 6-digit chapter codes with keyword mappings.
 * Organized by the 21 WCO Sections. Each entry maps real HS chapter codes
 * to searchable keywords from product_category or item descriptions.
 *
 * Format: HS code is stored as the 4-digit heading (first 4 digits of 6-digit HS code).
 * Example: "0101" = Chapter 01, Heading 01 → Live horses, asses, mules and hinnies
 *
 * Reference: WCO Harmonized System Nomenclature 2022 Edition
 */

const HSN_LOOKUP_TABLE: Array<{
  code: string;
  label: string;
  keywords: string[];
}> = [
  // ── Section I: Live Animals; Animal Products (Chapters 01-05)
  {
    code: "0101",
    label: "Live horses, asses, mules and hinnies",
    keywords: ["horse", "equine", "donkey", "mule", "ass"],
  },
  {
    code: "0102",
    label: "Live bovine animals",
    keywords: ["cattle", "cow", "bovine", "bull", "heifer", "ox"],
  },
  {
    code: "0103",
    label: "Live swine",
    keywords: ["pig", "swine", "pork animal", "hog"],
  },
  {
    code: "0104",
    label: "Live sheep and goats",
    keywords: ["sheep", "goat", "lamb"],
  },
  {
    code: "0105",
    label: "Live poultry",
    keywords: ["chicken", "poultry", "fowl", "turkey", "duck", "goose", "hen"],
  },
  {
    code: "0201",
    label: "Meat of bovine animals, fresh or chilled",
    keywords: ["beef", "veal", "bovine meat", "fresh beef"],
  },
  {
    code: "0203",
    label: "Meat of swine, fresh, chilled or frozen",
    keywords: ["pork", "pig meat", "swine meat", "bacon"],
  },
  {
    code: "0207",
    label: "Meat and edible offal of poultry",
    keywords: ["chicken meat", "poultry meat", "turkey meat"],
  },
  {
    code: "0301",
    label: "Live fish",
    keywords: ["live fish", "aquarium fish", "ornamental fish"],
  },
  {
    code: "0302",
    label: "Fish; fresh or chilled",
    keywords: [
      "fresh fish",
      "chilled fish",
      "salmon",
      "trout",
      "tuna",
      "cod",
      "mackerel",
    ],
  },
  {
    code: "0304",
    label: "Fish fillets and other fish meat",
    keywords: ["fish fillet", "fish meat", "fish steak"],
  },
  {
    code: "0306",
    label: "Crustaceans",
    keywords: ["shrimp", "prawn", "crab", "lobster", "crayfish", "crustacean"],
  },
  {
    code: "0401",
    label: "Milk and cream",
    keywords: ["milk", "cream", "dairy milk", "fresh milk"],
  },
  {
    code: "0402",
    label: "Milk and cream, concentrated or sweetened",
    keywords: ["condensed milk", "evaporated milk", "powdered milk"],
  },
  {
    code: "0403",
    label: "Buttermilk, yogurt and kefir",
    keywords: ["yogurt", "buttermilk", "kefir", "cultured milk"],
  },
  {
    code: "0405",
    label: "Butter and dairy fats",
    keywords: ["butter", "dairy fat", "ghee", "dairy spread"],
  },
  {
    code: "0406",
    label: "Cheese and curd",
    keywords: ["cheese", "curd", "cottage cheese", "mozzarella"],
  },
  {
    code: "0407",
    label: "Birds' eggs, in shell",
    keywords: ["egg", "eggs", "poultry egg", "hen egg"],
  },

  // ── Section II: Vegetable Products (Chapters 06-14)
  {
    code: "0601",
    label: "Bulbs, tubers and rhizomes",
    keywords: ["bulb", "tuber", "rhizome", "seed tuber", "onion set"],
  },
  {
    code: "0602",
    label: "Other live plants",
    keywords: [
      "plant",
      "sapling",
      "shrub",
      "tree seedling",
      "ornamental plant",
    ],
  },
  {
    code: "0603",
    label: "Cut flowers and flower buds",
    keywords: ["flower", "rose", "cut flower", "bouquet", "floral"],
  },
  {
    code: "0701",
    label: "Potatoes, fresh or chilled",
    keywords: ["potato", "potatoes"],
  },
  {
    code: "0702",
    label: "Tomatoes, fresh or chilled",
    keywords: ["tomato", "tomatoes"],
  },
  {
    code: "0703",
    label: "Onions, shallots, garlic, leeks",
    keywords: ["onion", "garlic", "leek", "shallot", "spring onion"],
  },
  {
    code: "0704",
    label: "Cabbages, cauliflowers and similar edible brassicas",
    keywords: ["cabbage", "cauliflower", "broccoli", "kale", "brussels sprout"],
  },
  {
    code: "0707",
    label: "Cucumbers and gherkins",
    keywords: ["cucumber", "gherkin"],
  },
  {
    code: "0709",
    label: "Other vegetables, fresh or chilled",
    keywords: [
      "vegetable",
      "vegetables",
      "fresh vegetable",
      "pepper",
      "eggplant",
      "okra",
    ],
  },
  {
    code: "0801",
    label: "Coconuts, Brazil nuts and cashew nuts",
    keywords: ["coconut", "cashew", "brazil nut", "cashewnut"],
  },
  {
    code: "0802",
    label: "Other nuts (almonds, hazelnuts, walnuts, pistachios)",
    keywords: ["almond", "walnut", "hazelnut", "pistachio", "pecan", "nut"],
  },
  { code: "0803", label: "Bananas", keywords: ["banana", "plantain"] },
  {
    code: "0804",
    label: "Dates, figs, pineapples, avocados, guavas, mangoes",
    keywords: ["mango", "date", "fig", "avocado", "guava", "pineapple"],
  },
  {
    code: "0805",
    label: "Citrus fruit",
    keywords: ["orange", "lemon", "lime", "grapefruit", "tangerine", "citrus"],
  },
  {
    code: "0806",
    label: "Grapes, fresh or dried",
    keywords: ["grape", "raisin", "sultana"],
  },
  {
    code: "0901",
    label: "Coffee",
    keywords: ["coffee", "coffee bean", "arabica", "robusta"],
  },
  {
    code: "0902",
    label: "Tea",
    keywords: ["tea", "green tea", "black tea", "herbal tea", "tea leaf"],
  },
  { code: "0903", label: "Maté", keywords: ["mate", "yerba"] },
  {
    code: "1001",
    label: "Wheat and meslin",
    keywords: ["wheat", "meslin", "flour wheat", "grain wheat"],
  },
  { code: "1002", label: "Rye", keywords: ["rye", "rye grain"] },
  { code: "1003", label: "Barley", keywords: ["barley"] },
  { code: "1004", label: "Oats", keywords: ["oat", "oats", "oatmeal"] },
  {
    code: "1005",
    label: "Maize (corn)",
    keywords: ["corn", "maize", "sweet corn", "popcorn maize"],
  },
  {
    code: "1006",
    label: "Rice",
    keywords: [
      "rice",
      "paddy",
      "brown rice",
      "white rice",
      "long grain rice",
      "jasmine rice",
      "basmati",
    ],
  },
  {
    code: "1007",
    label: "Grain sorghum",
    keywords: ["sorghum", "guinea corn", "grain sorghum"],
  },
  {
    code: "1008",
    label: "Buckwheat, millet and canary seed",
    keywords: ["millet", "buckwheat", "canary seed", "quinoa"],
  },
  {
    code: "1101",
    label: "Wheat or meslin flour",
    keywords: ["wheat flour", "all purpose flour", "bread flour"],
  },
  {
    code: "1102",
    label: "Cereal flours (maize, rye)",
    keywords: ["corn flour", "maize flour", "rye flour", "cassava flour"],
  },
  {
    code: "1104",
    label: "Worked cereal grains",
    keywords: ["cereal grain", "rolled oat", "flake", "grain flake"],
  },
  {
    code: "1201",
    label: "Soya beans",
    keywords: ["soybean", "soya", "soya bean"],
  },
  {
    code: "1202",
    label: "Ground-nuts (peanuts)",
    keywords: ["peanut", "groundnut", "groundnuts"],
  },
  {
    code: "1207",
    label: "Other oil seeds and oleaginous fruits",
    keywords: ["sunflower seed", "sesame", "rapeseed", "canola", "oil seed"],
  },
  {
    code: "1209",
    label: "Seeds for sowing",
    keywords: ["seed", "sowing seed", "planting seed"],
  },
  {
    code: "1301",
    label: "Lac; gums, resins and plant saps",
    keywords: ["gum", "resin", "lac", "shellac"],
  },

  // ── Section III: Animal/Vegetable Fats & Oils (Chapter 15)
  {
    code: "1501",
    label: "Pig fat and poultry fat",
    keywords: ["lard", "pig fat", "poultry fat"],
  },
  {
    code: "1507",
    label: "Soya-bean oil",
    keywords: ["soybean oil", "soya oil"],
  },
  {
    code: "1508",
    label: "Ground-nut oil",
    keywords: ["groundnut oil", "peanut oil"],
  },
  {
    code: "1509",
    label: "Olive oil",
    keywords: ["olive oil", "extra virgin olive oil"],
  },
  {
    code: "1511",
    label: "Palm oil",
    keywords: ["palm oil", "palm kernel oil", "red oil"],
  },
  {
    code: "1513",
    label: "Coconut oil and palm kernel oil",
    keywords: ["coconut oil"],
  },
  {
    code: "1516",
    label: "Hydrogenated animal or vegetable fats",
    keywords: ["margarine", "shortening", "hydrogenated fat"],
  },
  {
    code: "1517",
    label: "Margarine; edible mixtures of fats",
    keywords: ["vegetable oil blend", "cooking fat"],
  },

  // ── Section IV: Prepared Foodstuffs (Chapters 16-24)
  {
    code: "1601",
    label: "Sausages and similar products",
    keywords: ["sausage", "frankfurter", "salami", "hot dog"],
  },
  {
    code: "1602",
    label: "Other prepared meat or offal",
    keywords: ["canned meat", "prepared meat", "corned beef", "spam"],
  },
  {
    code: "1701",
    label: "Cane or beet sugar",
    keywords: [
      "sugar",
      "cane sugar",
      "beet sugar",
      "white sugar",
      "granulated sugar",
    ],
  },
  {
    code: "1702",
    label: "Other sugars (fructose, glucose, lactose)",
    keywords: [
      "glucose",
      "fructose",
      "lactose",
      "dextrose",
      "maltose",
      "honey syrup",
    ],
  },
  {
    code: "1704",
    label: "Sugar confectionery",
    keywords: [
      "candy",
      "sweet",
      "confectionery",
      "lollipop",
      "toffee",
      "caramel",
    ],
  },
  { code: "1801", label: "Cocoa beans", keywords: ["cocoa bean", "raw cocoa"] },
  {
    code: "1802",
    label: "Cocoa shells, husks and waste",
    keywords: ["cocoa shell", "cocoa waste"],
  },
  {
    code: "1805",
    label: "Cocoa powder",
    keywords: ["cocoa powder", "drinking chocolate"],
  },
  {
    code: "1806",
    label: "Chocolate and other cocoa preparations",
    keywords: ["chocolate", "cocoa preparation", "chocolate bar"],
  },
  {
    code: "1901",
    label: "Malt extract and food preparations of flour",
    keywords: [
      "malt",
      "malt extract",
      "cereal preparation",
      "baby food cereal",
    ],
  },
  {
    code: "1902",
    label: "Pasta",
    keywords: ["pasta", "noodle", "spaghetti", "macaroni", "vermicelli"],
  },
  {
    code: "1905",
    label: "Bread, pastry, cakes, biscuits",
    keywords: [
      "bread",
      "biscuit",
      "cake",
      "pastry",
      "cookie",
      "cracker",
      "wafer",
    ],
  },
  {
    code: "2001",
    label: "Vegetables preserved by vinegar",
    keywords: ["pickle", "pickled vegetable", "gherkin pickle"],
  },
  {
    code: "2002",
    label: "Tomatoes prepared or preserved",
    keywords: ["tomato paste", "tomato sauce", "ketchup", "tomato puree"],
  },
  {
    code: "2009",
    label: "Fruit and vegetable juices",
    keywords: ["juice", "fruit juice", "orange juice", "apple juice"],
  },
  {
    code: "2101",
    label: "Extracts of coffee, tea or maté",
    keywords: ["instant coffee", "coffee extract", "tea extract"],
  },
  {
    code: "2106",
    label: "Food preparations not elsewhere specified",
    keywords: [
      "food supplement",
      "nutritional supplement",
      "protein powder",
      "energy drink mix",
    ],
  },
  {
    code: "2201",
    label: "Waters including natural/artificial mineral waters",
    keywords: ["water", "mineral water", "drinking water", "bottled water"],
  },
  {
    code: "2202",
    label: "Waters with added sugar; soft drinks",
    keywords: [
      "soft drink",
      "soda",
      "fizzy drink",
      "carbonated drink",
      "energy drink",
    ],
  },
  {
    code: "2203",
    label: "Beer made from malt",
    keywords: ["beer", "lager", "ale", "stout", "malt drink"],
  },
  {
    code: "2205",
    label: "Vermouth and other wine",
    keywords: ["vermouth", "wine", "sparkling wine", "champagne"],
  },
  {
    code: "2207",
    label: "Ethyl alcohol",
    keywords: ["ethanol", "ethyl alcohol", "industrial alcohol"],
  },
  {
    code: "2208",
    label: "Spirits, whisky, brandy, rum, gin, vodka",
    keywords: [
      "whisky",
      "brandy",
      "rum",
      "gin",
      "vodka",
      "spirit",
      "liquor",
      "schnapps",
    ],
  },
  {
    code: "2301",
    label: "Flours, meals and pellets of fish or crustaceans",
    keywords: ["fish meal", "fish flour", "fishmeal"],
  },
  {
    code: "2302",
    label: "Bran, sharps and residues from cereals",
    keywords: ["bran", "wheat bran", "oat bran", "rice bran"],
  },
  {
    code: "2401",
    label: "Unmanufactured tobacco",
    keywords: ["tobacco leaf", "raw tobacco", "unmanufactured tobacco"],
  },
  {
    code: "2402",
    label: "Cigars, cigarettes and similar tobacco products",
    keywords: ["cigarette", "cigar", "tobacco product"],
  },

  // ── Section V: Mineral Products (Chapters 25-27)
  {
    code: "2501",
    label: "Salt; sulphur; earths and stone",
    keywords: ["salt", "sea salt", "rock salt", "sulphur"],
  },
  {
    code: "2504",
    label: "Natural graphite",
    keywords: ["graphite", "natural graphite"],
  },
  {
    code: "2601",
    label: "Iron ores and concentrates",
    keywords: ["iron ore", "iron concentrate"],
  },
  {
    code: "2603",
    label: "Copper ores and concentrates",
    keywords: ["copper ore"],
  },
  {
    code: "2701",
    label: "Coal; briquettes",
    keywords: ["coal", "briquette", "charcoal"],
  },
  {
    code: "2709",
    label: "Petroleum oils and oils from bituminous minerals, crude",
    keywords: ["crude oil", "crude petroleum", "petroleum crude"],
  },
  {
    code: "2710",
    label: "Petroleum oils (other than crude)",
    keywords: [
      "petrol",
      "diesel",
      "fuel oil",
      "kerosene",
      "lubricant",
      "petroleum",
      "motor oil",
    ],
  },
  {
    code: "2711",
    label: "Petroleum gas and other gaseous hydrocarbons",
    keywords: ["gas", "lpg", "natural gas", "cooking gas", "compressed gas"],
  },

  // ── Section VI: Chemical Products (Chapters 28-38)
  {
    code: "2801",
    label: "Fluorine, chlorine, bromine and iodine",
    keywords: ["chlorine", "fluorine", "bromine", "iodine"],
  },
  {
    code: "2804",
    label: "Hydrogen, noble gases and other non-metals",
    keywords: ["oxygen", "hydrogen", "nitrogen", "argon", "industrial gas"],
  },
  {
    code: "2814",
    label: "Ammonia",
    keywords: ["ammonia", "anhydrous ammonia"],
  },
  {
    code: "2901",
    label: "Acyclic hydrocarbons",
    keywords: ["methane", "ethane", "propane", "butane", "acyclic hydrocarbon"],
  },
  {
    code: "2903",
    label: "Halogenated derivatives of hydrocarbons",
    keywords: ["chloroform", "carbon tetrachloride", "refrigerant"],
  },
  {
    code: "3001",
    label: "Glands and organs for therapeutic use",
    keywords: ["organ extract", "biological material", "therapeutic gland"],
  },
  {
    code: "3002",
    label: "Human blood; vaccines, toxins, cultures",
    keywords: ["vaccine", "blood", "serum", "toxoid", "antigen", "antibody"],
  },
  {
    code: "3003",
    label: "Medicaments (mixed) for therapeutic use, not in measured doses",
    keywords: [
      "medicine",
      "drug",
      "pharmaceutical",
      "medicament",
      "medication",
      "remedy",
    ],
  },
  {
    code: "3004",
    label: "Medicaments in measured doses (retail)",
    keywords: [
      "tablet",
      "capsule",
      "syrup",
      "injection",
      "prescription",
      "pharma retail",
    ],
  },
  {
    code: "3005",
    label: "Wadding, gauze and bandages",
    keywords: ["bandage", "gauze", "dressing", "wound care", "plaster"],
  },
  {
    code: "3006",
    label: "Pharmaceutical goods (diagnostic reagents, contraceptives)",
    keywords: ["diagnostic", "reagent", "contraceptive", "sterile item"],
  },
  {
    code: "3101",
    label: "Animal or vegetable fertilisers",
    keywords: ["organic fertilizer", "compost", "manure", "animal fertilizer"],
  },
  {
    code: "3102",
    label: "Mineral or chemical fertilisers, nitrogenous",
    keywords: ["urea", "ammonium nitrate", "nitrogen fertilizer", "npk"],
  },
  {
    code: "3401",
    label: "Soap, washing products and surface-active products",
    keywords: ["soap", "detergent", "washing powder", "laundry", "dishwashing"],
  },
  {
    code: "3402",
    label: "Organic surface-active agents (not soap)",
    keywords: ["surfactant", "cleaner", "cleaning agent", "disinfectant"],
  },
  {
    code: "3405",
    label: "Polishes, creams and preparations for surfaces",
    keywords: ["polish", "wax polish", "shoe polish", "furniture polish"],
  },
  {
    code: "3406",
    label: "Candles, tapers and the like",
    keywords: ["candle", "taper", "wax candle"],
  },
  {
    code: "3407",
    label: "Modelling pastes; dental wax",
    keywords: ["modelling paste", "dental wax", "clay model"],
  },
  {
    code: "3501",
    label: "Casein and casein derivatives",
    keywords: ["casein"],
  },
  {
    code: "3601",
    label: "Propellent powders",
    keywords: ["propellant", "gunpowder", "explosive powder"],
  },
  {
    code: "3701",
    label: "Photographic plates and film",
    keywords: ["photo film", "photographic plate", "camera film"],
  },
  {
    code: "3801",
    label: "Artificial graphite; preparations based on graphite",
    keywords: ["artificial graphite", "graphite electrode", "carbon electrode"],
  },
  {
    code: "3802",
    label: "Activated carbon",
    keywords: ["activated carbon", "activated charcoal", "carbon filter"],
  },
  {
    code: "3808",
    label: "Insecticides, rodenticides, fungicides and herbicides",
    keywords: [
      "insecticide",
      "pesticide",
      "herbicide",
      "fungicide",
      "rodenticide",
      "weedkiller",
    ],
  },
  {
    code: "3811",
    label: "Anti-knock preparations and lubricating additives",
    keywords: [
      "additive",
      "anti-knock",
      "lubricating additive",
      "fuel additive",
    ],
  },
  {
    code: "3814",
    label: "Organic composite solvents",
    keywords: ["solvent", "paint thinner", "acetone", "organic solvent"],
  },
  {
    code: "3815",
    label: "Reaction initiators, accelerators and catalysts",
    keywords: ["catalyst", "accelerator", "reaction initiator"],
  },
  {
    code: "3824",
    label: "Chemical preparations not elsewhere specified",
    keywords: ["chemical preparation", "chemical mixture", "reagent kit"],
  },

  // ── Section VII: Plastics & Rubber (Chapters 39-40)
  {
    code: "3901",
    label: "Polymers of ethylene",
    keywords: ["polyethylene", "pe", "hdpe", "ldpe"],
  },
  {
    code: "3902",
    label: "Polymers of propylene",
    keywords: ["polypropylene", "pp plastic"],
  },
  {
    code: "3904",
    label: "Polymers of vinyl chloride (PVC)",
    keywords: ["pvc", "polyvinyl chloride", "vinyl"],
  },
  {
    code: "3915",
    label: "Waste and scrap of plastics",
    keywords: ["plastic waste", "plastic scrap", "plastic recycling"],
  },
  {
    code: "3920",
    label: "Other plates, sheets, film of plastics",
    keywords: [
      "plastic sheet",
      "plastic film",
      "plastic plate",
      "plastic wrap",
    ],
  },
  {
    code: "3926",
    label: "Other articles of plastics",
    keywords: [
      "plastic product",
      "plastic article",
      "plastic container",
      "plastic part",
    ],
  },
  {
    code: "4001",
    label: "Natural rubber and gum",
    keywords: ["natural rubber", "latex", "gum latex"],
  },
  {
    code: "4002",
    label: "Synthetic rubber",
    keywords: ["synthetic rubber", "neoprene", "nitrile rubber"],
  },
  {
    code: "4011",
    label: "New pneumatic tyres",
    keywords: ["tyre", "tire", "pneumatic tyre", "car tyre", "truck tyre"],
  },
  {
    code: "4016",
    label: "Other articles of vulcanised rubber",
    keywords: [
      "rubber product",
      "rubber article",
      "rubber seal",
      "rubber gasket",
    ],
  },

  // ── Section VIII: Leather & Skins (Chapters 41-43)
  {
    code: "4101",
    label: "Raw hides and skins of bovine animals",
    keywords: ["raw hide", "cow hide", "bovine hide"],
  },
  {
    code: "4104",
    label: "Tanned/crust hides of bovine animals",
    keywords: ["leather", "tanned leather", "crust leather"],
  },
  {
    code: "4203",
    label: "Articles of apparel and accessories of leather",
    keywords: [
      "leather bag",
      "leather belt",
      "leather jacket",
      "leather glove",
      "leather shoe",
    ],
  },
  { code: "4301", label: "Raw furskins", keywords: ["fur", "furskin", "pelt"] },

  // ── Section IX: Wood & Wood Products (Chapters 44-46)
  {
    code: "4401",
    label: "Fuel wood, wood in chips or particles",
    keywords: ["firewood", "wood chips", "wood pellet", "sawdust"],
  },
  {
    code: "4403",
    label: "Wood in the rough",
    keywords: ["round wood", "log", "timber log"],
  },
  {
    code: "4407",
    label: "Wood sawn or chipped lengthwise",
    keywords: ["sawn timber", "plank", "lumber", "sawn wood"],
  },
  {
    code: "4410",
    label: "Particle board, OSB and similar board",
    keywords: ["particle board", "mdf", "chipboard", "osb"],
  },
  {
    code: "4411",
    label: "Fibreboard of wood",
    keywords: ["fibreboard", "hardboard", "fibre board"],
  },
  { code: "4412", label: "Plywood", keywords: ["plywood", "blockboard"] },
  {
    code: "4418",
    label: "Builders' joinery and carpentry of wood",
    keywords: [
      "door frame",
      "window frame",
      "wood panel",
      "wood floor",
      "parquet",
    ],
  },
  {
    code: "4819",
    label: "Cartons, boxes and cases of paper or paperboard",
    keywords: ["cardboard box", "carton", "corrugated box", "packaging box"],
  },
  {
    code: "4820",
    label: "Registers, account books, notebooks",
    keywords: [
      "notebook",
      "exercise book",
      "ledger",
      "account book",
      "register",
    ],
  },

  // ── Section X: Paper & Paperboard (Chapters 47-49)
  {
    code: "4701",
    label: "Mechanical wood pulp",
    keywords: ["wood pulp", "mechanical pulp"],
  },
  {
    code: "4801",
    label: "Newsprint",
    keywords: ["newsprint", "newspaper paper"],
  },
  {
    code: "4802",
    label: "Uncoated paper and paperboard for writing",
    keywords: ["writing paper", "printing paper", "office paper", "a4 paper"],
  },
  {
    code: "4901",
    label: "Printed books and brochures",
    keywords: [
      "book",
      "textbook",
      "brochure",
      "printed book",
      "educational book",
    ],
  },
  {
    code: "4902",
    label: "Newspapers, journals and periodicals",
    keywords: ["newspaper", "journal", "magazine", "periodical"],
  },
  {
    code: "4906",
    label: "Plans, drawings and photographs",
    keywords: ["blueprint", "architectural drawing", "technical drawing"],
  },

  // ── Section XI: Textiles (Chapters 50-63)
  {
    code: "5001",
    label: "Silk-worm cocoons",
    keywords: ["silk cocoon", "silkworm"],
  },
  {
    code: "5101",
    label: "Wool, not carded or combed",
    keywords: ["raw wool", "fleece"],
  },
  {
    code: "5201",
    label: "Cotton, not carded or combed",
    keywords: ["raw cotton", "cotton bale"],
  },
  {
    code: "5208",
    label: "Woven fabrics of cotton, < 85% cotton",
    keywords: ["cotton fabric", "cotton cloth", "woven cotton"],
  },
  {
    code: "5309",
    label: "Woven fabrics of flax",
    keywords: ["linen fabric", "flax fabric"],
  },
  {
    code: "5407",
    label: "Woven fabrics of synthetic filament yarn",
    keywords: ["nylon fabric", "polyester fabric", "synthetic fabric"],
  },
  {
    code: "5512",
    label: "Woven fabrics of synthetic staple fibres",
    keywords: ["polyester cloth", "acrylic fabric", "synthetic cloth"],
  },
  {
    code: "5601",
    label: "Wadding of textile materials",
    keywords: ["cotton wool", "wadding", "batting"],
  },
  {
    code: "5806",
    label: "Narrow woven fabrics; labels, badges",
    keywords: ["ribbon", "label", "badge", "narrow fabric"],
  },
  {
    code: "6101",
    label: "Overcoats, raincoats, anoraks of knitted fabric",
    keywords: ["overcoat", "raincoat", "anorak", "hoodie knit"],
  },
  {
    code: "6201",
    label: "Men's overcoats, raincoats and similar articles",
    keywords: ["men coat", "men jacket", "men raincoat"],
  },
  {
    code: "6203",
    label: "Men's suits, jackets, trousers",
    keywords: [
      "suit",
      "trouser",
      "men trousers",
      "men suit",
      "blazer",
      "men jacket",
    ],
  },
  {
    code: "6204",
    label: "Women's suits, jackets, dresses, skirts, trousers",
    keywords: [
      "women suit",
      "women dress",
      "skirt",
      "women jacket",
      "women trousers",
    ],
  },
  {
    code: "6205",
    label: "Men's shirts",
    keywords: ["men shirt", "dress shirt", "formal shirt"],
  },
  {
    code: "6206",
    label: "Women's blouses and shirts",
    keywords: ["blouse", "women shirt", "women blouse"],
  },
  {
    code: "6207",
    label: "Men's vests and underpants",
    keywords: ["vest", "underwear", "boxer", "brief"],
  },
  {
    code: "6211",
    label: "Track suits, ski suits and swimwear",
    keywords: ["tracksuit", "sportswear", "swimwear", "gym wear", "activewear"],
  },
  {
    code: "6212",
    label: "Brassieres, corsets and girdles",
    keywords: ["brassiere", "bra", "corset", "girdle"],
  },
  {
    code: "6215",
    label: "Ties, bow ties and cravats",
    keywords: ["tie", "necktie", "bow tie", "cravat"],
  },
  {
    code: "6301",
    label: "Blankets and travelling rugs",
    keywords: ["blanket", "rug", "throw"],
  },
  {
    code: "6302",
    label: "Bed linen, table linen, toilet linen",
    keywords: ["bedsheet", "bed linen", "towel", "table cloth", "pillow case"],
  },
  {
    code: "6303",
    label: "Curtains and interior blinds",
    keywords: ["curtain", "blind", "drape"],
  },
  {
    code: "6305",
    label: "Sacks and bags of textile materials",
    keywords: ["jute bag", "sack", "woven bag", "burlap"],
  },
  {
    code: "6401",
    label: "Waterproof footwear with rubber soles",
    keywords: ["boot", "rubber boot", "wellington", "waterproof shoe"],
  },
  {
    code: "6403",
    label: "Footwear with leather uppers",
    keywords: ["shoe", "leather shoe", "sandal", "loafer", "oxford shoe"],
  },
  {
    code: "6404",
    label: "Footwear with textile uppers",
    keywords: [
      "sneaker",
      "trainer",
      "canvas shoe",
      "sport shoe",
      "athletic shoe",
    ],
  },
  {
    code: "6406",
    label: "Parts of footwear; shoe accessories",
    keywords: ["sole", "insole", "shoelace", "heel", "shoe part"],
  },
  {
    code: "6501",
    label: "Hat-forms, hat bodies and hoods",
    keywords: ["hat form", "hat body"],
  },
  {
    code: "6505",
    label: "Hats and headgear, knitted or assembled",
    keywords: ["hat", "cap", "headgear", "beanie", "beret"],
  },

  // ── Section XII: Footwear, Headgear, Umbrellas, etc. (Chapters 64-67)
  {
    code: "6601",
    label: "Umbrellas and sun umbrellas",
    keywords: ["umbrella", "parasol", "sun umbrella"],
  },
  {
    code: "6701",
    label: "Skins and feathers of birds",
    keywords: ["feather", "bird skin", "down feather", "quill"],
  },

  // ── Section XIII: Stone, Plaster, Cement, Asbestos, Mica (Chapters 68-70)
  {
    code: "6801",
    label: "Paving and roofing stone",
    keywords: ["paving stone", "roofing slate", "flagstone"],
  },
  {
    code: "6810",
    label: "Articles of cement, concrete or artificial stone",
    keywords: [
      "concrete block",
      "cement block",
      "precast concrete",
      "concrete product",
    ],
  },
  {
    code: "6901",
    label: "Bricks, blocks, tiles and similar articles",
    keywords: ["brick", "fire brick", "ceramic block", "refractory brick"],
  },
  {
    code: "6907",
    label: "Ceramic tiles",
    keywords: ["ceramic tile", "floor tile", "wall tile", "porcelain tile"],
  },
  {
    code: "7010",
    label: "Glass containers for packing",
    keywords: ["glass bottle", "glass jar", "glass container"],
  },
  {
    code: "7013",
    label: "Glassware for table, kitchen and household",
    keywords: ["glass cup", "glass bowl", "glassware", "drinking glass"],
  },

  // ── Section XIV: Pearls, Precious Stones, Metals, Coins (Chapters 71)
  {
    code: "7101",
    label: "Pearls, natural or cultured",
    keywords: ["pearl", "cultured pearl"],
  },
  {
    code: "7102",
    label: "Diamonds",
    keywords: ["diamond", "raw diamond", "cut diamond"],
  },
  {
    code: "7108",
    label: "Gold",
    keywords: ["gold", "gold bar", "gold bullion"],
  },
  {
    code: "7110",
    label: "Platinum",
    keywords: ["platinum", "palladium", "rhodium"],
  },
  {
    code: "7113",
    label: "Jewellery and parts thereof",
    keywords: [
      "jewellery",
      "ring",
      "necklace",
      "bracelet",
      "earring",
      "jewelry",
    ],
  },
  {
    code: "7117",
    label: "Imitation jewellery",
    keywords: ["imitation jewellery", "costume jewelry", "fashion jewellery"],
  },

  // ── Section XV: Base Metals (Chapters 72-83)
  {
    code: "7201",
    label: "Pig iron and spiegeleisen",
    keywords: ["pig iron", "cast iron"],
  },
  {
    code: "7204",
    label: "Ferrous waste and scrap",
    keywords: ["scrap metal", "iron scrap", "steel scrap"],
  },
  {
    code: "7208",
    label: "Flat-rolled products of iron or non-alloy steel",
    keywords: ["steel sheet", "steel plate", "steel roll", "mild steel"],
  },
  {
    code: "7213",
    label: "Bars and rods of iron or non-alloy steel",
    keywords: ["steel bar", "rebar", "steel rod", "iron bar"],
  },
  {
    code: "7214",
    label: "Other bars and rods of iron or non-alloy steel",
    keywords: ["angle iron", "structural steel", "steel section"],
  },
  {
    code: "7217",
    label: "Wire of iron or non-alloy steel",
    keywords: ["wire", "steel wire", "iron wire", "barbed wire"],
  },
  {
    code: "7228",
    label: "Other bars and rods of other alloy steel",
    keywords: ["alloy steel bar", "stainless steel rod"],
  },
  {
    code: "7304",
    label: "Tubes, pipes and hollow profiles of iron or steel",
    keywords: ["steel pipe", "iron pipe", "hollow section", "steel tube"],
  },
  {
    code: "7317",
    label: "Nails, tacks, drawing pins",
    keywords: ["nail", "tack", "drawing pin", "staple"],
  },
  {
    code: "7318",
    label: "Screws, bolts, nuts, washers",
    keywords: ["screw", "bolt", "nut", "washer", "fastener"],
  },
  {
    code: "7323",
    label: "Table, kitchen or household articles of iron or steel",
    keywords: ["iron pot", "steel pot", "kitchen utensil", "steel pan"],
  },
  {
    code: "7326",
    label: "Other articles of iron or steel",
    keywords: [
      "iron article",
      "steel article",
      "metal fitting",
      "steel fitting",
    ],
  },
  {
    code: "7403",
    label: "Refined copper and copper alloys, unwrought",
    keywords: ["copper", "refined copper", "copper rod"],
  },
  {
    code: "7407",
    label: "Copper bars, rods and profiles",
    keywords: ["copper bar", "copper pipe", "copper tube"],
  },
  {
    code: "7606",
    label: "Aluminium plates, sheets and strip",
    keywords: ["aluminium sheet", "aluminum sheet", "aluminium plate"],
  },
  {
    code: "7607",
    label: "Aluminium foil",
    keywords: ["aluminium foil", "aluminum foil", "foil wrap"],
  },
  {
    code: "7610",
    label: "Aluminium structures and parts",
    keywords: ["aluminium frame", "aluminum structure", "curtain wall"],
  },
  { code: "8001", label: "Tin, unwrought", keywords: ["tin", "tin metal"] },
  {
    code: "8301",
    label: "Padlocks and locks of base metal",
    keywords: ["padlock", "lock", "door lock", "deadbolt"],
  },
  {
    code: "8302",
    label: "Base metal fittings for buildings",
    keywords: ["hinge", "door hinge", "handle", "knob", "fitting"],
  },
  {
    code: "8311",
    label: "Wire and rods for soldering, welding",
    keywords: ["welding rod", "solder wire", "welding electrode"],
  },

  // ── Section XVI: Machinery & Electrical Equipment (Chapters 84-85)
  {
    code: "8401",
    label: "Nuclear reactors and their parts",
    keywords: ["nuclear reactor", "reactor vessel"],
  },
  {
    code: "8406",
    label: "Steam turbines",
    keywords: ["steam turbine", "turbine"],
  },
  {
    code: "8408",
    label: "Compression-ignition engines (diesel)",
    keywords: ["diesel engine", "compression engine"],
  },
  {
    code: "8409",
    label: "Parts for engines of headings 8407 and 8408",
    keywords: ["engine part", "piston", "crankshaft", "cylinder"],
  },
  {
    code: "8411",
    label: "Turbo-jets, turbo-propellers and other gas turbines",
    keywords: ["jet engine", "gas turbine", "turbojet"],
  },
  {
    code: "8413",
    label: "Pumps for liquids",
    keywords: [
      "water pump",
      "liquid pump",
      "centrifugal pump",
      "submersible pump",
    ],
  },
  {
    code: "8414",
    label: "Air or vacuum pumps, compressors and fans",
    keywords: ["compressor", "air pump", "fan", "blower", "vacuum pump"],
  },
  {
    code: "8415",
    label: "Air conditioning machines",
    keywords: [
      "air conditioner",
      "ac unit",
      "air conditioning",
      "hvac",
      "split unit",
    ],
  },
  {
    code: "8418",
    label: "Refrigerators, freezers and heat pumps",
    keywords: ["refrigerator", "fridge", "freezer", "cold room", "ice maker"],
  },
  {
    code: "8421",
    label: "Centrifuges; filtering machinery for liquids/gases",
    keywords: [
      "filter",
      "centrifuge",
      "water filter",
      "air filter",
      "oil filter",
    ],
  },
  {
    code: "8422",
    label: "Dish washing machines; packing/wrapping machinery",
    keywords: [
      "dishwasher",
      "packing machine",
      "wrapping machine",
      "filling machine",
    ],
  },
  {
    code: "8423",
    label: "Weighing machinery",
    keywords: [
      "weighing scale",
      "weight scale",
      "balance scale",
      "industrial scale",
    ],
  },
  {
    code: "8424",
    label: "Mechanical appliances for spraying liquids or powders",
    keywords: ["spray machine", "sprayer", "nebulizer", "paint sprayer"],
  },
  {
    code: "8428",
    label: "Other lifting, handling, loading machinery",
    keywords: [
      "conveyor",
      "elevator",
      "forklift",
      "crane",
      "hoist",
      "escalator",
    ],
  },
  {
    code: "8430",
    label: "Other moving, grading, levelling machinery for mining",
    keywords: ["excavator", "bulldozer", "grader", "mining equipment"],
  },
  {
    code: "8433",
    label: "Harvesting machinery; threshing machinery",
    keywords: ["harvester", "thresher", "combine harvester", "farm harvester"],
  },
  {
    code: "8436",
    label: "Other agricultural machinery",
    keywords: [
      "agricultural machine",
      "farm equipment",
      "tractor implement",
      "plough",
    ],
  },
  {
    code: "8443",
    label: "Printing machinery",
    keywords: [
      "printer",
      "printing machine",
      "printing press",
      "inkjet printer",
      "laser printer",
    ],
  },
  {
    code: "8450",
    label: "Household or laundry washing machines",
    keywords: ["washing machine", "washer", "laundry machine"],
  },
  {
    code: "8451",
    label: "Machinery for washing, cleaning or drying",
    keywords: ["dryer", "textile dryer", "industrial dryer"],
  },
  {
    code: "8452",
    label: "Sewing machines",
    keywords: ["sewing machine", "industrial sewing", "embroidery machine"],
  },
  {
    code: "8453",
    label: "Machinery for tanning hides or skins",
    keywords: ["tanning machine", "leather processing machine"],
  },
  {
    code: "8462",
    label: "Machine tools for working metal by forging/bending",
    keywords: [
      "press machine",
      "forging machine",
      "bending machine",
      "stamping machine",
    ],
  },
  {
    code: "8471",
    label: "Automatic data processing machines (computers)",
    keywords: [
      "computer",
      "laptop",
      "desktop",
      "server",
      "mainframe",
      "data processing",
    ],
  },
  {
    code: "8473",
    label: "Parts and accessories for office machines",
    keywords: ["computer part", "keyboard", "mouse", "monitor", "motherboard"],
  },
  {
    code: "8479",
    label: "Machines having individual functions not elsewhere specified",
    keywords: ["industrial machine", "special machine", "robot", "robotic arm"],
  },
  {
    code: "8481",
    label: "Taps, cocks, valves for pipes and tanks",
    keywords: ["valve", "tap", "cock", "ball valve", "gate valve"],
  },
  {
    code: "8482",
    label: "Ball or roller bearings",
    keywords: ["bearing", "ball bearing", "roller bearing"],
  },
  {
    code: "8483",
    label: "Transmission shafts and cranks; gearing",
    keywords: ["shaft", "gearing", "gear box", "pulley", "sprocket"],
  },
  {
    code: "8501",
    label: "Electric motors and generators",
    keywords: ["electric motor", "generator", "alternator", "dynamo"],
  },
  {
    code: "8502",
    label: "Electric generating sets and rotary converters",
    keywords: [
      "generating set",
      "genset",
      "power generator",
      "diesel generator",
    ],
  },
  {
    code: "8504",
    label: "Electrical transformers and static converters",
    keywords: [
      "transformer",
      "power transformer",
      "voltage regulator",
      "inverter",
      "ups",
    ],
  },
  {
    code: "8506",
    label: "Primary cells and primary batteries",
    keywords: ["battery", "dry cell", "primary battery", "alkaline battery"],
  },
  {
    code: "8507",
    label: "Electric accumulators (secondary batteries)",
    keywords: [
      "rechargeable battery",
      "lead acid battery",
      "lithium battery",
      "accumulator",
    ],
  },
  {
    code: "8516",
    label: "Electric water heaters, hair-dryers, smoothing irons",
    keywords: [
      "water heater",
      "hair dryer",
      "iron",
      "electric iron",
      "heating element",
    ],
  },
  {
    code: "8517",
    label: "Telephone sets; smartphones and telecommunication apparatus",
    keywords: [
      "phone",
      "smartphone",
      "mobile phone",
      "telephone",
      "pbx",
      "router",
      "modem",
      "telecom",
    ],
  },
  {
    code: "8518",
    label: "Microphones, loudspeakers and headphones",
    keywords: [
      "speaker",
      "microphone",
      "headphone",
      "earphone",
      "audio equipment",
    ],
  },
  {
    code: "8519",
    label: "Sound recording and reproducing apparatus",
    keywords: ["sound recorder", "amplifier", "turntable", "audio player"],
  },
  {
    code: "8521",
    label: "Video recording apparatus",
    keywords: ["video recorder", "vcr", "dvd recorder", "set top box"],
  },
  {
    code: "8523",
    label: "Storage media (discs, tapes, flash drives, storage cards)",
    keywords: [
      "flash drive",
      "usb drive",
      "memory card",
      "sd card",
      "hard drive",
      "ssd",
      "storage media",
    ],
  },
  {
    code: "8524",
    label: "Flat panel display modules",
    keywords: ["display module", "flat panel", "lcd module", "oled module"],
  },
  {
    code: "8525",
    label: "Transmission apparatus for radio-broadcasting or TV",
    keywords: [
      "transmitter",
      "broadcast equipment",
      "radio transmitter",
      "tv transmitter",
    ],
  },
  {
    code: "8527",
    label: "Reception apparatus for radio-broadcasting",
    keywords: ["radio", "radio receiver", "car radio", "am fm radio"],
  },
  {
    code: "8528",
    label: "TV receivers and monitors",
    keywords: [
      "television",
      "tv",
      "monitor",
      "display screen",
      "led tv",
      "smart tv",
    ],
  },
  {
    code: "8535",
    label: "Electrical apparatus for switching circuits (>1000V)",
    keywords: [
      "circuit breaker",
      "switchgear",
      "disconnect switch",
      "high voltage switch",
    ],
  },
  {
    code: "8536",
    label: "Electrical apparatus for switching circuits (≤1000V)",
    keywords: [
      "switch",
      "socket",
      "plug",
      "electrical switch",
      "relay",
      "fuse",
    ],
  },
  {
    code: "8537",
    label: "Boards, panels and consoles for electrical control",
    keywords: [
      "distribution board",
      "panel board",
      "control panel",
      "switchboard",
    ],
  },
  {
    code: "8541",
    label: "Semiconductor devices; solar cells",
    keywords: [
      "diode",
      "transistor",
      "semiconductor",
      "solar cell",
      "photovoltaic",
      "solar panel",
      "led chip",
    ],
  },
  {
    code: "8542",
    label: "Electronic integrated circuits",
    keywords: [
      "integrated circuit",
      "ic chip",
      "microchip",
      "processor chip",
      "circuit board",
    ],
  },
  {
    code: "8544",
    label: "Insulated wire, cable and electrical conductors",
    keywords: [
      "wire",
      "cable",
      "electrical cable",
      "coaxial cable",
      "fiber cable",
      "electrical wire",
    ],
  },
  {
    code: "8545",
    label: "Carbon electrodes and other electrical carbon items",
    keywords: ["carbon electrode", "carbon brush"],
  },

  // ── Section XVII: Vehicles, Aircraft, Vessels (Chapters 86-89)
  {
    code: "8601",
    label: "Rail locomotives powered from external electricity source",
    keywords: ["electric train", "tram", "metro train"],
  },
  {
    code: "8701",
    label: "Tractors",
    keywords: ["tractor", "farm tractor", "agricultural tractor"],
  },
  {
    code: "8702",
    label: "Motor vehicles for public transport (buses)",
    keywords: ["bus", "minibus", "coach", "public transport vehicle"],
  },
  {
    code: "8703",
    label: "Motor cars and other passenger vehicles",
    keywords: ["car", "automobile", "passenger car", "sedan", "suv", "vehicle"],
  },
  {
    code: "8704",
    label: "Motor vehicles for goods transport",
    keywords: ["truck", "lorry", "pickup truck", "goods vehicle", "van"],
  },
  {
    code: "8705",
    label: "Special purpose motor vehicles",
    keywords: ["ambulance", "fire truck", "crane truck", "special vehicle"],
  },
  {
    code: "8706",
    label: "Chassis fitted with engines",
    keywords: ["chassis", "vehicle chassis"],
  },
  {
    code: "8707",
    label: "Bodies (including cabs) for vehicles",
    keywords: ["car body", "vehicle body", "cab"],
  },
  {
    code: "8708",
    label: "Parts and accessories for motor vehicles",
    keywords: [
      "auto part",
      "car part",
      "bumper",
      "tyre rim",
      "gear",
      "automotive",
    ],
  },
  {
    code: "8711",
    label: "Motorcycles and cycles fitted with auxiliary motor",
    keywords: ["motorcycle", "motorbike", "scooter", "moped"],
  },
  {
    code: "8714",
    label: "Parts and accessories for motorcycles",
    keywords: ["motorcycle part", "bike accessory"],
  },
  {
    code: "8715",
    label: "Baby carriages and parts",
    keywords: ["baby carriage", "pram", "stroller"],
  },
  {
    code: "8716",
    label: "Trailers and semi-trailers",
    keywords: ["trailer", "semi-trailer", "caravan"],
  },
  {
    code: "8801",
    label: "Balloons and dirigibles; gliders and other non-powered aircraft",
    keywords: ["glider", "balloon", "airship"],
  },
  {
    code: "8802",
    label: "Helicopters, aeroplanes and other powered aircraft",
    keywords: ["aeroplane", "aircraft", "helicopter", "airplane", "jet"],
  },
  {
    code: "8901",
    label: "Cruise ships, cargo ships and barges",
    keywords: ["ship", "vessel", "cargo ship", "tanker", "barge"],
  },

  // ── Section XVIII: Optical, Medical, Photographic Instruments (Chapters 90-92)
  {
    code: "9001",
    label: "Optical fibres and optical fibre cables",
    keywords: ["optical fibre", "optical fiber", "fibre optic cable"],
  },
  {
    code: "9004",
    label: "Spectacles, goggles and the like",
    keywords: ["spectacles", "glasses", "sunglasses", "goggles", "eyewear"],
  },
  {
    code: "9006",
    label: "Photographic cameras",
    keywords: ["camera", "digital camera", "dslr", "mirrorless camera"],
  },
  {
    code: "9013",
    label: "Liquid crystal devices; lasers",
    keywords: ["laser", "lcd device", "laser equipment", "optical device"],
  },
  {
    code: "9015",
    label: "Surveying, hydrographic instruments",
    keywords: [
      "survey instrument",
      "theodolite",
      "gps device",
      "total station",
    ],
  },
  {
    code: "9018",
    label: "Instruments for medicine, surgery and dentistry",
    keywords: [
      "medical instrument",
      "surgical instrument",
      "dental equipment",
      "scalpel",
      "syringe",
    ],
  },
  {
    code: "9019",
    label: "Mechano-therapy appliances; massage apparatus",
    keywords: [
      "massage machine",
      "physiotherapy",
      "exercise equipment",
      "treadmill",
    ],
  },
  {
    code: "9021",
    label: "Orthopaedic appliances; artificial body parts",
    keywords: [
      "prosthetic",
      "orthopaedic",
      "crutch",
      "wheelchair",
      "artificial limb",
    ],
  },
  {
    code: "9022",
    label: "X-ray apparatus",
    keywords: ["x-ray machine", "ct scan", "mri machine", "imaging equipment"],
  },
  {
    code: "9025",
    label: "Thermometers, barometers, hygrometers",
    keywords: ["thermometer", "barometer", "hygrometer", "weather instrument"],
  },
  {
    code: "9026",
    label: "Instruments for measuring flow or level of liquids",
    keywords: ["flow meter", "level sensor", "pressure gauge", "water meter"],
  },
  {
    code: "9027",
    label: "Instruments for physical or chemical analysis",
    keywords: [
      "analyser",
      "spectrometer",
      "chromatograph",
      "lab instrument",
      "laboratory equipment",
    ],
  },
  {
    code: "9028",
    label: "Gas, liquid or electricity supply meters",
    keywords: ["electricity meter", "gas meter", "utility meter", "kwh meter"],
  },
  {
    code: "9029",
    label: "Revolution counters, production counters, speedometers",
    keywords: ["speedometer", "tachometer", "revolution counter"],
  },
  {
    code: "9030",
    label: "Oscilloscopes and instruments for measuring electrical quantities",
    keywords: [
      "oscilloscope",
      "multimeter",
      "voltmeter",
      "ammeter",
      "electrical tester",
    ],
  },
  {
    code: "9031",
    label: "Measuring or checking instruments not elsewhere classified",
    keywords: [
      "measuring instrument",
      "testing equipment",
      "quality control instrument",
    ],
  },
  {
    code: "9032",
    label: "Automatic regulating instruments and apparatus",
    keywords: [
      "thermostat",
      "controller",
      "automation device",
      "plc",
      "pid controller",
    ],
  },

  // ── Section XIX: Arms and Ammunition (Chapter 93)
  {
    code: "9301",
    label: "Military weapons",
    keywords: ["military weapon", "gun", "rifle", "artillery"],
  },
  {
    code: "9303",
    label: "Firearms and similar appliances",
    keywords: ["firearm", "shotgun", "pistol", "revolver"],
  },
  {
    code: "9306",
    label: "Bombs, grenades, ammunition",
    keywords: ["ammunition", "bullet", "cartridge", "grenade"],
  },

  // ── Section XX: Miscellaneous Manufactured Articles (Chapters 94-96)
  {
    code: "9401",
    label: "Seats and their parts",
    keywords: [
      "chair",
      "sofa",
      "seat",
      "couch",
      "settee",
      "armchair",
      "bench seat",
    ],
  },
  {
    code: "9402",
    label: "Medical, surgical, dental or veterinary furniture",
    keywords: [
      "hospital bed",
      "medical furniture",
      "dental chair",
      "examination table",
    ],
  },
  {
    code: "9403",
    label: "Other furniture and parts",
    keywords: [
      "furniture",
      "table",
      "wardrobe",
      "shelf",
      "desk",
      "bookcase",
      "cabinet",
      "dresser",
    ],
  },
  {
    code: "9404",
    label: "Mattresses, quilts, eiderdowns and cushions",
    keywords: ["mattress", "pillow", "quilt", "cushion", "duvet"],
  },
  {
    code: "9405",
    label: "Lamps and lighting fittings not elsewhere classified",
    keywords: [
      "lamp",
      "light",
      "lighting",
      "led lamp",
      "fluorescent lamp",
      "lantern",
      "chandelier",
    ],
  },
  {
    code: "9406",
    label: "Prefabricated buildings",
    keywords: [
      "prefab building",
      "container house",
      "modular building",
      "prefabricated structure",
    ],
  },
  {
    code: "9501",
    label: "Wheeled toys designed to be ridden by children",
    keywords: ["bicycle toy", "children scooter", "ride on toy"],
  },
  {
    code: "9503",
    label: "Tricycles, scooters, pedal cars and toys",
    keywords: [
      "toy",
      "doll",
      "toy car",
      "action figure",
      "board game",
      "puzzle",
      "lego",
      "game",
    ],
  },
  {
    code: "9504",
    label: "Video games and gaming equipment",
    keywords: [
      "video game",
      "game console",
      "gaming",
      "playstation",
      "xbox",
      "nintendo",
    ],
  },
  {
    code: "9505",
    label: "Festive, carnival or other entertainment articles",
    keywords: [
      "christmas decoration",
      "party supplies",
      "carnival",
      "halloween",
      "festive item",
    ],
  },
  {
    code: "9506",
    label: "Articles for sport or outdoor games; pools",
    keywords: [
      "sport equipment",
      "football",
      "basketball",
      "swimming pool",
      "gym equipment",
      "sports",
    ],
  },
  {
    code: "9507",
    label: "Fishing rods, hooks and fishing equipment",
    keywords: ["fishing rod", "fishing", "fish hook", "bait"],
  },
  {
    code: "9601",
    label: "Worked ivory, bone and similar articles",
    keywords: ["ivory carving", "bone carving", "horn carving"],
  },
  {
    code: "9603",
    label: "Brooms, brushes and mops",
    keywords: ["broom", "brush", "mop", "cleaning brush", "scrubber"],
  },
  {
    code: "9605",
    label: "Travel sets for personal toilet",
    keywords: ["travel kit", "grooming kit", "toilet set"],
  },
  {
    code: "9606",
    label: "Buttons and snap-fasteners",
    keywords: ["button", "snap fastener", "press stud"],
  },
  {
    code: "9607",
    label: "Slide fasteners (zip fasteners)",
    keywords: ["zip", "zipper", "slide fastener"],
  },
  {
    code: "9608",
    label: "Ball point pens; felt-tipped pens; propelling pencils",
    keywords: [
      "pen",
      "ballpoint pen",
      "felt tip",
      "marker pen",
      "pencil",
      "highlighter",
    ],
  },
  {
    code: "9609",
    label: "Pencils, crayons and pastels",
    keywords: ["crayon", "coloured pencil", "pastel", "chalk"],
  },
  {
    code: "9612",
    label: "Typewriter or similar ribbons; ink-pads",
    keywords: ["ink pad", "ink ribbon", "stamp pad", "ink"],
  },
  {
    code: "9613",
    label: "Cigarette lighters and other lighters",
    keywords: ["lighter", "cigarette lighter", "gas lighter"],
  },
  {
    code: "9615",
    label: "Combs, hair-slides and the like",
    keywords: ["comb", "hair clip", "hair pin", "hair accessory"],
  },
  {
    code: "9616",
    label: "Scent sprays and similar toilet sprays",
    keywords: ["perfume spray", "deodorant spray", "toilet spray", "atomizer"],
  },
  {
    code: "9617",
    label: "Vacuum flasks and other vacuum vessels",
    keywords: ["thermos", "vacuum flask", "insulated bottle"],
  },
  {
    code: "9618",
    label: "Tailors' dummies and other lay figures",
    keywords: ["mannequin", "tailor dummy", "display form"],
  },

  // ── Section XXI: Works of Art, Collectors' Pieces and Antiques (Chapter 97)
  {
    code: "9701",
    label: "Paintings, drawings and pastels",
    keywords: [
      "painting",
      "artwork",
      "drawing",
      "watercolour",
      "canvas",
      "art",
    ],
  },
  {
    code: "9702",
    label: "Original engravings, prints and lithographs",
    keywords: ["engraving", "print", "lithograph"],
  },
  {
    code: "9703",
    label: "Original sculptures and statuary",
    keywords: ["sculpture", "statue", "figurine", "statuette"],
  },
  {
    code: "9705",
    label: "Collections and collectors' pieces",
    keywords: ["coin collection", "stamp collection", "antique", "collectible"],
  },
];

/**
 * Find the best matching real WCO/HS code for a given product or service description.
 * Searches the lookup table by keyword matching and returns the HS code in FIRS format
 * (4-digit heading + ".00"), e.g., "8471.00" for computers.
 *
 * @param description - The product category, service category or item description to look up
 * @returns A valid HS code string in FIRS format, or a safe default if no match found
 */
export function lookupHsnCode(description: string): string {
  if (!description || typeof description !== "string") return "9999.00";

  const normalized = description.toLowerCase().trim();

  let bestMatch: { code: string; score: number } | undefined;

  for (const entry of HSN_LOOKUP_TABLE) {
    let score = 0;
    for (const keyword of entry.keywords) {
      if (normalized.includes(keyword)) {
        // Longer / more specific keyword matches score higher
        score += keyword.length;
      }
    }
    if (score > 0 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { code: entry.code, score };
    }
  }

  if (bestMatch) {
    return `${bestMatch.code}.00`;
  }

  // Fallback: return a general merchandise code
  return "9999.00";
}

/**
 * Generates a valid, industry-standard WCO HS code for a missing hsn_code on an invoice line.
 * Uses the product_category or service_category to find a matching real HS code.
 * Falls through a set of common codes if no category description is provided.
 *
 * @param existingCodes - Set of codes already used on this invoice (to avoid duplicates)
 * @param lineDescription - Optional product_category or item description for smart lookup
 * @returns A real HS code string in FIRS format (e.g. "8471.00")
 */
export function generateUniqueHsnCode(
  existingCodes: Set<string>,
  lineDescription?: string,
): string {
  // Try smart lookup first if we have a description
  if (lineDescription) {
    const looked = lookupHsnCode(lineDescription);
    if (!existingCodes.has(looked)) {
      existingCodes.add(looked);
      return looked;
    }
  }

  // Common fallback codes across major WCO chapters (avoid returning random numbers)
  const fallbackCodes = [
    "9403.00", // Furniture
    "8471.00", // Computers
    "8517.00", // Telecom equipment
    "3004.00", // Pharmaceuticals
    "8413.00", // Pumps
    "7308.00", // Iron/steel structures
    "9018.00", // Medical instruments
    "8544.00", // Cables
    "6403.00", // Footwear
    "6203.00", // Apparel
    "0207.00", // Poultry
    "1006.00", // Rice
    "2710.00", // Petroleum
    "8428.00", // Machinery
    "3402.00", // Cleaning products
    "1701.00", // Sugar
    "9503.00", // Toys
    "2201.00", // Water
    "8516.00", // Electrical appliances
    "3808.00", // Pesticides
  ];

  for (const code of fallbackCodes) {
    if (!existingCodes.has(code)) {
      existingCodes.add(code);
      return code;
    }
  }

  // Ultimate fallback: find any unused code from the lookup table
  for (const entry of HSN_LOOKUP_TABLE) {
    const code = `${entry.code}.00`;
    if (!existingCodes.has(code)) {
      existingCodes.add(code);
      return code;
    }
  }

  return "9999.00";
}

export function generateIRN(
  invoiceNumber: string,
  serviceId: string | undefined,
  date: Date = new Date(),
): string | undefined {
  let finalServiceId = serviceId;
  let baseRef = invoiceNumber;

  if (invoiceNumber && typeof invoiceNumber === "string") {
    // Check if the invoiceNumber is already a valid FIRS IRN pattern (e.g. PREFIX-SERVICEID-DATE)
    const match = invoiceNumber
      .trim()
      .match(/^([A-Z0-9]+)-([A-Z0-9]{8})-([0-9]{8})$/i);
    if (match) {
      if (!finalServiceId) {
        finalServiceId = match[2];
      }
      baseRef = match[1];
    }
  }

  if (!finalServiceId) return undefined;

  // Validate inputs: invoiceNumber alphanumeric, serviceId 8 alphanumeric
  let padding = generateRandomString(4).substring(0, 4).toUpperCase();
  const inv = (baseRef + padding).replace(/[^A-Za-z0-9]/g, "");
  if (!/^[A-Za-z0-9]+$/.test(inv)) return undefined;
  // if (!/^[A-Za-z0-9]{8}$/.test(finalServiceId)) return undefined;
  return `${inv}-${finalServiceId}-${generateDatestamp(date)}`.toUpperCase();
}

export const FIRS_SCHEMA_EXAMPLE = `{
    "business_id": "8f8b8e88-6b83-4a34-934d-1a8684bb57f2",
    "irn": "IRN",
    "issue_date": "2024-05-14",
    "due_date": "2024-06-14",
    "issue_time": "17:59:04",
    "invoice_type_code": "396",
    "invoice_kind": "B2B",
    "payment_status": "PENDING",
    "note": "dummy_note (will be encryted in storage)",
    "tax_point_date": "2024-05-14",
    "document_currency_code": "NGN",
    "tax_currency_code": "NGN",
    "accounting_cost": "2000 NGN",
    "buyer_reference": "buyer REF IRN?",
    "invoice_delivery_period": {
        "start_date": "2024-06-14",
        "end_date": "2024-06-16"
    },
    "order_reference": "order REF IRN?",
    "billing_reference": [
        {
            "irn": "ITW001-E9E0C0D3-20240619",
            "issue_date": "2024-05-14"
        }
    ],
    "dispatch_document_reference": {
        "irn": "ITW001-E9E0C0D3-20240619",
        "issue_date": "2024-05-14"
    },
    "receipt_document_reference": {
        "irn": "ITW001-E9E0C0D3-20240619",
        "issue_date": "2024-05-14"
    },
    "originator_document_reference": {
        "irn": "ITW001-E9E0C0D3-20240619",
        "issue_date": "2024-05-14"
    },
    "contract_document_reference": {
        "irn": "ITW001-E9E0C0D3-20240619",
        "issue_date": "2024-05-14"
    },
    "additional_document_reference": [
        {
            "irn": "ITW001-E9E0C0D3-20240619",
            "issue_date": "2024-05-14"
        }
    ],
    "accounting_supplier_party": {
        "party_name": "Heirs Technologies",
        "tin": "TIN-0099990001",
        "email": "supplier_business@email.com",
        "telephone": "+23480254099000",
        "business_description": "this entity is into sales of Cement and building materials",
        "postal_address": {
            "street_name": "32, owonikoko street",
            "city_name": "Gwarikpa",
            "postal_zone": "023401",
            "lga": "NG-AB-ANO",
            "state": "NG-AB",
            "country": "NG"
        }
    },
    "accounting_customer_party": {
        "party_name": "Dangote Group",
        "tin": "TIN-000001",
        "email": "business@email.com",
        "telephone": "+23480254000000",
        "business_description": "this entity is into sales of Cement and building materials",
        "postal_address": {
            "street_name": "32, owonikoko street",
            "city_name": "Gwarikpa",
            "postal_zone": "023401",
            "lga": "NG-AB-ANO",
            "state": "NG-AB",
            "country": "NG"
        }
    },
    "actual_delivery_date": "2024-05-14",
    "payment_means": [
        {
            "payment_means_code": "10",
            "payment_due_date": "2024-05-14"
        }
    ],
    "payment_terms_note": "dummy payment terms note (will be encryted in storage)",
    "allowance_charge": [
        {
            "charge_indicator": true,
            "amount": 800.60
        }
    ],
    "tax_total": [
        {
            "tax_amount": 56.07,
            "tax_subtotal": [
                {
                    "taxable_amount": 800,
                    "tax_amount": 8,
                    "tax_category": {
                        "id": "STANDARD_VAT",
                        "percent": 7.5
                    }
                }
            ]
        }
    ],
    "legal_monetary_total": {
        "line_extension_amount": 340.50,
        "tax_exclusive_amount": 400,
        "tax_inclusive_amount": 430,
        "payable_amount": 30
    },
    "invoice_line": [
        {
            "hsn_code": "1006.30",
            "product_category": "Cereals; rice, semi-milled or wholly milled",
            "discount_rate": 2.01,
            "discount_amount": 0.603,
            "fee_rate": 1.01,
            "fee_amount": 50,
            "invoiced_quantity": 15,
            "line_extension_amount": 30,
            "item": {
                "name": "item name",
                "description": "item description",
                "sellers_item_identification": "identified as spoon by the seller"
            },
            "price": {
                "price_amount": 10,
                "base_quantity": 3,
                "price_unit": "XBG"
            }
        },
        {
            "isic_code": "0112",
            "service_category": "Growing of rice",
            "discount_rate": 2.01,
            "discount_amount": 0.603,
            "fee_rate": 1.01,
            "fee_amount": 50,
            "invoiced_quantity": 15,
            "line_extension_amount": 30,
            "item": {
                "name": "item name 2",
                "description": "item description 2",
                "sellers_item_identification": "identified as shovel by the seller"
            },
            "price": {
                "price_amount": 20,
                "base_quantity": 5,
                "price_unit": "XBG"
            }
        }
    ],
    "invoice_reference": "INV20251007014"
}`;

export const SYSTEM_PROMPT = (
  invoice_data: any,
  today: string,
  invoiceRef: string,
  context?: string,
) => `You are an expert data transformation AI. Transform the following invoice data into the exact FIRS (Federal Inland Revenue Service) e-invoicing schema format.

CRITICAL REQUIREMENTS:

MANDATORY FIELDS (MUST BE PRESENT):
- business_id: Use "{{TEST_BUSINESS_ID}}" if not provided
- irn: Generate a unique invoice reference if not provided (format: INVYYYYMMDDXXX)
- issue_date: REQUIRED, use today (${today}) if not provided
- invoice_type_code: REQUIRED, default to "396" if not specified
- invoice_kind: REQUIRED, default to "B2B" if not specified
- document_currency_code: REQUIRED, default to "NGN"
- accounting_supplier_party: REQUIRED with party_name, tin, email, and postal_address
- accounting_customer_party: REQUIRED with party_name, tin, email, and postal_address
- tax_total: REQUIRED - must include tax_amount and tax_subtotal array (CRITICAL FOR VALIDATION)
- legal_monetary_total: REQUIRED with line_extension_amount, tax_exclusive_amount, tax_inclusive_amount, payable_amount
- invoice_line: REQUIRED array with at least one item containing invoiced_quantity, line_extension_amount, item (name, description), price; PLUS either hsn_code (goods) or isic_code (services)


TAX TOTAL REQUIREMENTS (VERY IMPORTANT):
- tax_total MUST be present as an array with at least one object
- Each tax_total object must contain:
  * tax_amount: total tax amount for this tax type
  * tax_subtotal: array of tax breakdowns
- Each tax_subtotal must contain:
  * taxable_amount: amount subject to tax
  * tax_amount: tax amount for this subtotal
  * tax_category: object with id and percent

DATE FORMATTING RULES:
1. ALL dates MUST be in YYYY-MM-DD format (e.g., "2024-05-14")
2. NEVER leave date fields empty or as empty strings
3. For missing dates in document references, use the main invoice's issue_date
4. Times must be in HH:MM:SS format

AUTO-POPULATION RULES:
1. If payment_status missing: default to "PENDING"
2. If document_currency_code missing: default to "NGN"
3. If tax_currency_code missing: default to "NGN"
4. If postal_zone missing: use "100001"
5. If telephone provided: ensure it starts with "+" (country code)
6. Generate invoice_reference if missing: "${invoiceRef}"
7. If tax_total missing: calculate from invoice lines or use zero tax

OPTIONAL FIELD HANDLING:
- due_date, issue_time, note, tax_point_date, accounting_cost, buyer_reference: Include if available
- invoice_delivery_period, order_reference: Include if available
- billing_reference, additional_document_reference: Include as arrays if available
- dispatch_document_reference, receipt_document_reference, originator_document_reference, contract_document_reference: Include as objects if available
- payment_means, allowance_charge: Include as arrays if available
- payee_party, bill_party, ship_party, tax_representative_party: Include as party objects if available in the input
- postal_address.lga, postal_address.state: Include if available in the input

PRICE UNIT RULES (CRITICAL):
- price_unit MUST be a UN/ECE Recommendation 20 unit-of-measure code. It is NOT a currency code.
- NEVER use "NGN", "USD", "NGN per 1", "NGN/1", or any currency as price_unit.
- Common valid price_unit codes:
  * H87  = Piece (default for most goods — use when unsure)
  * XBG  = Bag (e.g., 50kg bag of rice)
  * XBX  = Box
  * XCT  = Carton
  * KGM  = Kilogram
  * TNE  = Tonne (metric ton)
  * LTR  = Litre
  * MTR  = Metre
  * SET  = Set
  * DZN  = Dozen
- If the unit from the input is a currency or unrecognised, default to "H87" (piece).

- hsn_code: Used ONLY for goods/products. Must be a real WCO Harmonized System (HS) 4-digit heading code followed by ".00". Format: "XXXX.00" where XXXX is a valid HS heading.
- isic_code: Used ONLY for services. Must be a real ISIC (International Standard Industrial Classification) code.
- A line item for GOODS must have hsn_code (e.g., "8471.00" for computers, "1006.00" for rice, "8703.00" for vehicles)
- A line item for SERVICES must have isic_code (e.g., "6201" for financial services, "6920" for accounting, "7010" for real estate)
- DO NOT use both hsn_code and isic_code on the same invoice line
- DO NOT generate random 4-digit numbers for hsn_code
- Common real HS codes by category:
  * Food & Agriculture: rice=1006, wheat=1001, maize/corn=1005, sugar=1701, palm oil=1511, fish=0302, chicken=0207
  * Building/Construction: cement=2523, steel bar=7213, iron pipe=7304, ceramic tile=6907, paint=3210
  * Electronics: computer=8471, smartphone=8517, tv=8528, generator=8502, transformer=8504, cable=8544, solar panel=8541
  * Vehicles: car=8703, truck=8704, motorcycle=8711, bus=8702, tractor=8701
  * Chemicals/Pharma: medicine=3004, vaccine=3002, fertilizer=3102, pesticide=3808, soap=3401
  * Textiles/Apparel: fabric=5208, shirt=6205, trouser=6203, shoe=6403, hat=6505
  * Machinery: pump=8413, compressor=8414, weighing scale=8423, printing machine=8443, sewing machine=8452
  * Petroleum: crude oil=2709, diesel/petrol=2710, lpg=2711
  * General merchandise/unknown goods: use 9403 (furniture) or 9503 (toys/misc)

INVOICE LINE CLASSIFICATION RULES:
- If the line item is a physical product: set hsn_code to the appropriate HS heading (e.g., "8471.00" for a laptop)
- If the line item is a service: set isic_code to the appropriate ISIC code; do NOT set hsn_code
- item.name is REQUIRED - use the product name or service name from the input data
- item.description is REQUIRED - provide a brief description

PARTY INFORMATION RULES:
- accounting_supplier_party: MANDATORY (party_name, tin, email, postal_address)
- accounting_customer_party: MANDATORY (party_name, tin, email, postal_address)
- All party objects require: party_name, tin, email, postal_address
- Telephone must start with "+" if provided

VALID tax categories: {"code": 200,"data": [{"code": "STANDARD_GST","value": "Standard Goods and Services Tax","percent": "Not Available"},{"code": "REDUCED_GST","value": "Reduced Goods and Services Tax","percent": "Not Available"},{"code": "ZERO_GST","value": "Zero Goods and Services Tax","percent": "Not Available"},{"code": "STANDARD_VAT","value": "Standard Value-Added Tax","percent": "7.5"},{"code": "REDUCED_VAT","value": "Reduced Value-Added Tax","percent": "7.5"},{"code": "ZERO_VAT","value": "Zero Value-Added Tax","percent": "0.0"},{"code": "STATE_SALES_TAX","value": "State Sales Tax","percent": "Not Available"},{"code": "LOCAL_SALES_TAX","value": "Local Sales Tax","percent": "Not Available"},{"code": "ALCOHOL_EXCISE_TAX","value": "Alcohol Excise Tax","percent": "Not Available"},{"code": "TOBACCO_EXCISE_TAX","value": "Tobacco Excise Tax","percent": "Not Available"},{"code": "FUEL_EXCISE_TAX","value": "Fuel Excise Tax","percent": ""},{"code": "CORPORATE_INCOME_TAX","value": "Corporate Income Tax","percent": "Not Available"},{"code": "PERSONAL_INCOME_TAX","value": "Personal Income Tax","percent": "Not Available"},{"code": "SOCIAL_SECURITY_TAX","value": "Social Security Tax","percent": "Not Available"},{"code": "MEDICARE_TAX","value": "Medicare Tax","percent": ""},{"code": "REAL_ESTATE_TAX","value": "Real Estate Tax","percent": "Not Available"},{"code": "PERSONAL_PROPERTY_TAX","value": "Personal Property Tax","percent": "Not Available"},{"code": "CARBON_TAX","value": "Carbon Tax","percent": "Not Available"},{"code": "PLASTIC_TAX","value": "Plastic Tax","percent": "Not Available"},{"code": "IMPORT_DUTY","value": "Import Duty","percent": "Not Available"},{"code": "EXPORT_DUTY","value": "Export Duty","percent": "Not Available"},{"code": "LUXURY_TAX","value": "Luxury Tax","percent": "Not Available"},{"code": "SERVICE_TAX","value": "Service Tax","percent": "Not Available"},{"code": "TOURISM_TAX","value": "Tourism Tax","percent": "Not Available"}]}

IMPORTANT INSTRUCTIONS:
1. Return ONLY valid JSON in the exact FIRS schema format, do not include any other text or comments or special characters or html tags or any other formatting
2. Do not include any explanation, comments, or additional text
3. Map the input data intelligently to the appropriate FIRS fields
4. Use reasonable defaults for missing mandatory fields
5. Ensure all amounts and calculations are accurate and are all in valid numbers
6. For arrays, include only if data is available (don't create empty arrays)
7. TAX_TOTAL IS MANDATORY - include it even if tax is zero
8. TAX_TOTAL MUST BE PRESENT - include it even if tax is zero
9. All fields that are enum should be in the format of the example provided and must not use arbitrary values
10. Do not include any other text or comments or special characters or html tags or any other formatting (\\n, \\t, \\r, \\b, \\f, \\v)
11. Make sure values like email, phone number, postal codes are valid based on the FIRS schema rules so there will not be errors
12. HSN codes MUST be real WCO/HS heading codes. Do NOT use random numbers. Determine the correct HS chapter from the product type.
13. item.name is REQUIRED in every invoice_line item object - use the product or service name

FIRS SCHEMA EXAMPLE:
${FIRS_SCHEMA_EXAMPLE}

INPUT INVOICE DATA:
${JSON.stringify(invoice_data, null, 2)}

Transform the input data to match the FIRS schema exactly. Return only the JSON with no comments`;
