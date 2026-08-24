import { t } from "elysia";

/**
 * Standard success response schema wrapper for resource lookup endpoints.
 */
const resourceResponseSchema = (dataSchema: any, exampleData: any) =>
  t.Object({
    success: t.Boolean({
      example: true,
      description: "Operation success status",
    }),
    data: t.Array(dataSchema, {
      description: "List of resource reference items",
      examples: [exampleData],
    }),
  });

/**
 * Validation & OpenAPI metadata for GET /invoice/resources/payment_means
 */
export const listPaymentMeansValidation = {
  detail: {
    summary: "Get FIRS Payment Means & Methods",
    description:
      "Retrieve all valid FIRS payment means codes (e.g., 30 for Credit Transfer, 48 for Bank Card, 10 for Cash) and descriptions.",
    tags: ["Resources"],
    responses: {
      200: {
        description: "Successfully retrieved list of payment means",
        content: {
          "application/json": {
            schema: resourceResponseSchema(
              t.Object({
                code: t.String({
                  example: "30",
                  description: "Payment means code",
                }),
                name: t.String({
                  example: "Credit Transfer",
                  description: "Payment means description",
                }),
              }),
              [
                { code: "10", name: "In cash" },
                { code: "30", name: "Credit transfer" },
                { code: "48", name: "Bank card" },
              ],
            ),
          },
        },
      },
    },
  },
};

/**
 * Validation & OpenAPI metadata for GET /invoice/resources/tax-categories
 */
export const listTaxCategoriesValidation = {
  detail: {
    summary: "Get FIRS Tax Categories",
    description:
      "Retrieve all valid FIRS tax categories (e.g., Standard VAT 7.5%, Exempt, Zero-Rated) and associated percentage rates.",
    tags: ["Resources"],
    responses: {
      200: {
        description: "Successfully retrieved list of tax categories",
        content: {
          "application/json": {
            schema: resourceResponseSchema(
              t.Object({
                id: t.String({
                  example: "STANDARD_VAT",
                  description: "Tax category identifier",
                }),
                name: t.String({
                  example: "Standard VAT",
                  description: "Tax category name",
                }),
                percent: t.Number({
                  example: 7.5,
                  description: "Tax percentage rate",
                }),
              }),
              [
                { id: "STANDARD_VAT", name: "Standard VAT", percent: 7.5 },
                { id: "EXEMPT", name: "Exempt from Tax", percent: 0 },
              ],
            ),
          },
        },
      },
    },
  },
};

/**
 * Validation & OpenAPI metadata for GET /invoice/resources/currencies
 */
export const listCurrenciesValidation = {
  detail: {
    summary: "Get FIRS Supported Currencies",
    description:
      "Retrieve all ISO 4217 currency codes (e.g., NGN, USD, EUR, GBP) supported by FIRS for document and tax currency specifications.",
    tags: ["Resources"],
    responses: {
      200: {
        description: "Successfully retrieved list of currencies",
        content: {
          "application/json": {
            schema: resourceResponseSchema(
              t.Object({
                symbol: t.String({
                  example: "₦",
                  description: "Currency symbol",
                }),
                name: t.String({
                  example: "Nigerian Naira",
                  description: "Currency name",
                }),
                symbol_native: t.String({
                  example: "₦",
                  description: "Native currency symbol",
                }),
                decimal_digits: t.Number({
                  example: 2,
                  description: "Decimal digits",
                }),
                rounding: t.Number({
                  example: 0,
                  description: "Rounding",
                }),
                code: t.String({
                  example: "NGN",
                  description: "ISO 4217 currency code",
                }),
                name_plural: t.String({
                  example: "Nigerian nairas",
                  description: "Plural name",
                }),
              }),
              [
                {
                  symbol: "₦",
                  name: "Nigerian Naira",
                  symbol_native: "₦",
                  decimal_digits: 2,
                  rounding: 0,
                  code: "NGN",
                  name_plural: "Nigerian nairas",
                },
                {
                  symbol: "$",
                  name: "US Dollar",
                  symbol_native: "$",
                  decimal_digits: 2,
                  rounding: 0,
                  code: "USD",
                  name_plural: "US dollars",
                },
              ],
            ),
          },
        },
      },
    },
  },
};

/**
 * Validation & OpenAPI metadata for GET /invoice/resources/invoice-quantity-codes
 */
export const listQuantityCodesValidation = {
  detail: {
    summary: "Get UN/ECE Quantity & Unit Codes",
    description:
      "Retrieve valid UN/ECE Recommendation 20 unit of measure codes (e.g., H87 for Piece, KGM for Kilogram, LTR for Litre).",
    tags: ["Resources"],
    responses: {
      200: {
        description: "Successfully retrieved list of quantity unit codes",
        content: {
          "application/json": {
            schema: resourceResponseSchema(
              t.Object({
                code: t.String({
                  example: "H87",
                  description: "UN/ECE unit code",
                }),
                name: t.String({
                  example: "Piece",
                  description: "Unit description",
                }),
              }),
              [
                { code: "H87", name: "Piece" },
                { code: "KGM", name: "Kilogram" },
                { code: "LTR", name: "Litre" },
              ],
            ),
          },
        },
      },
    },
  },
};

/**
 * Validation & OpenAPI metadata for GET /invoice/resources/hs-codes
 */
export const listHsCodesValidation = {
  detail: {
    summary: "Get WCO Harmonized System (HS) Codes",
    description:
      "Retrieve WCO Harmonized System classification codes used for physical goods items on FIRS invoices.",
    tags: ["Resources"],
    responses: {
      200: {
        description: "Successfully retrieved list of HS codes",
        content: {
          "application/json": {
            schema: resourceResponseSchema(
              t.Object({
                code: t.String({
                  example: "8471.30",
                  description: "Formatted HS code",
                }),
                description: t.String({
                  example: "Portable automatic data processing machines",
                  description: "Goods category description",
                }),
              }),
              [
                {
                  code: "8471.30",
                  description: "Laptops and portable computers",
                },
                {
                  code: "8517.13",
                  description: "Smartphones and mobile phones",
                },
              ],
            ),
          },
        },
      },
    },
  },
};

/**
 * Validation & OpenAPI metadata for GET /invoice/resources/services-codes
 */
export const listServicesCodesValidation = {
  detail: {
    summary: "Get ISIC Service Classification Codes",
    description:
      "Retrieve International Standard Industrial Classification (ISIC) codes used for service line items on FIRS invoices.",
    tags: ["Resources"],
    responses: {
      200: {
        description: "Successfully retrieved list of ISIC service codes",
        content: {
          "application/json": {
            schema: resourceResponseSchema(
              t.Object({
                code: t.String({
                  example: "6201",
                  description: "ISIC service code",
                }),
                description: t.String({
                  example: "Computer programming activities",
                  description: "Service activity description",
                }),
              }),
              [
                {
                  code: "6201",
                  description: "Computer programming activities",
                },
                {
                  code: "6920",
                  description:
                    "Accounting, bookkeeping and auditing activities",
                },
              ],
            ),
          },
        },
      },
    },
  },
};

/**
 * Validation & OpenAPI metadata for GET /invoice/resources/lgas
 */
export const listLgasValidation = {
  detail: {
    summary: "Get Nigeria Local Government Areas (LGAs)",
    description:
      "Retrieve all valid Local Government Areas in Nigeria for supplier/customer postal address validation.",
    tags: ["Resources"],
    responses: {
      200: {
        description: "Successfully retrieved list of Nigeria LGAs",
        content: {
          "application/json": {
            schema: resourceResponseSchema(
              t.Object({
                code: t.String({
                  example: "NG-LA-IKE",
                  description: "LGA unique code",
                }),
                name: t.String({ example: "Ikeja", description: "LGA name" }),
                state_code: t.String({
                  example: "NG-LA",
                  description: "State code",
                }),
              }),
              [
                { code: "NG-LA-IKE", name: "Ikeja", state_code: "NG-LA" },
                {
                  code: "NG-FC-AMAC",
                  name: "Abuja Municipal",
                  state_code: "NG-FC",
                },
              ],
            ),
          },
        },
      },
    },
  },
};

/**
 * Validation & OpenAPI metadata for GET /invoice/resources/states
 */
export const listStatesValidation = {
  detail: {
    summary: "Get Nigeria States & State Codes",
    description:
      "Retrieve all states in Nigeria along with their standardized FIRS state codes (e.g., NG-LA for Lagos, NG-FC for FCT).",
    tags: ["Resources"],
    responses: {
      200: {
        description: "Successfully retrieved list of Nigeria states",
        content: {
          "application/json": {
            schema: resourceResponseSchema(
              t.Object({
                code: t.String({
                  example: "NG-LA",
                  description: "State ISO / FIRS code",
                }),
                name: t.String({ example: "Lagos", description: "State name" }),
              }),
              [
                { code: "NG-LA", name: "Lagos" },
                { code: "NG-FC", name: "Federal Capital Territory" },
                { code: "NG-RI", name: "Rivers" },
              ],
            ),
          },
        },
      },
    },
  },
};

/**
 * Validation & OpenAPI metadata for GET /invoice/resources/countries
 */
export const listCountriesValidation = {
  detail: {
    summary: "Get ISO 3166-1 Country Codes",
    description:
      "Retrieve all ISO 3166-1 alpha-2 country codes (e.g., NG for Nigeria, US for United States, GB for United Kingdom).",
    tags: ["Resources"],
    responses: {
      200: {
        description: "Successfully retrieved list of ISO country codes",
        content: {
          "application/json": {
            schema: resourceResponseSchema(
              t.Object({
                code: t.String({
                  example: "NG",
                  description: "ISO 3166-1 alpha-2 country code",
                }),
                name: t.String({
                  example: "Nigeria",
                  description: "Country full name",
                }),
              }),
              [
                { code: "NG", name: "Nigeria" },
                { code: "US", name: "United States" },
                { code: "GB", name: "United Kingdom" },
              ],
            ),
          },
        },
      },
    },
  },
};
