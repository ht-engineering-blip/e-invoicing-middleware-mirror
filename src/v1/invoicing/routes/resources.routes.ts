import Elysia from "elysia";
import { logger } from "../../../@lib";
import { FIRSService } from "../../../@lib/adapters/firs/firs.service";
import {
  listCountriesValidation,
  listCurrenciesValidation,
  listHsCodesValidation,
  listLgasValidation,
  listPaymentMeansValidation,
  listQuantityCodesValidation,
  listServicesCodesValidation,
  listStatesValidation,
  listTaxCategoriesValidation,
} from "../validations/resources.validation";

const firsService = new FIRSService();

/**
 * FIRS Invoicing Dynamic Reference Resources Routes
 *
 * Exposes dynamic lookup endpoints for FIRS-compliant invoicing reference data.
 * All resources are dynamically retrieved from FIRS endpoints and cached in memory.
 */
const resourcesRoutes = new Elysia({ prefix: "/invoice/resources" })
  /**
   * GET /api/v1/invoice/resources/payment_means
   * Retrieve valid FIRS payment means codes (e.g. Bank Transfer, Card, Cash).
   */
  .get(
    "/payment_means",
    async ({ set }) => {
      try {
        const data = await firsService.getResource("payment-means");
        return { success: true, data };
      } catch (error: any) {
        logger.error("Failed to fetch payment means resource", {
          error: error.message,
        });
        set.status = 500;
        return {
          success: false,
          error: "Failed to retrieve payment means codes",
        };
      }
    },
    listPaymentMeansValidation,
  )

  /**
   * GET /api/v1/invoice/resources/tax-categories
   * Retrieve valid FIRS tax categories (e.g. Standard VAT 7.5%, Exempt, Zero-Rated).
   */
  .get(
    "/tax-categories",
    async ({ set }) => {
      try {
        const data = await firsService.getResource("tax-categories");
        return { success: true, data };
      } catch (error: any) {
        logger.error("Failed to fetch tax categories resource", {
          error: error.message,
        });
        set.status = 500;
        return {
          success: false,
          error: "Failed to retrieve tax categories",
        };
      }
    },
    listTaxCategoriesValidation,
  )

  /**
   * GET /api/v1/invoice/resources/currencies
   * Retrieve valid currency codes (ISO 4217, e.g. NGN, USD, EUR) supported by FIRS.
   */
  .get(
    "/currencies",
    async ({ set }) => {
      try {
        const data = await firsService.getResource("currencies");
        return { success: true, data };
      } catch (error: any) {
        logger.error("Failed to fetch currencies resource", {
          error: error.message,
        });
        set.status = 500;
        return {
          success: false,
          error: "Failed to retrieve currency codes",
        };
      }
    },
    listCurrenciesValidation,
  )

  /**
   * GET /api/v1/invoice/resources/invoice-quantity-codes
   * Retrieve valid quantity and unit of measure codes (UN/ECE Recommendation 20).
   */
  .get(
    "/invoice-quantity-codes",
    async ({ set }) => {
      try {
        const data = await firsService.getResource("invoice-quantity-codes");
        return { success: true, data };
      } catch (error: any) {
        logger.error("Failed to fetch invoice quantity codes resource", {
          error: error.message,
        });
        set.status = 500;
        return {
          success: false,
          error: "Failed to retrieve quantity unit codes",
        };
      }
    },
    listQuantityCodesValidation,
  )

  /**
   * GET /api/v1/invoice/resources/hs-codes
   * Retrieve Harmonized System (HS) classification codes for goods.
   */
  .get(
    "/hs-codes",
    async ({ set }) => {
      try {
        const data = await firsService.getResource("hs-codes");
        return { success: true, data };
      } catch (error: any) {
        logger.error("Failed to fetch HS codes resource", {
          error: error.message,
        });
        set.status = 500;
        return {
          success: false,
          error: "Failed to retrieve HS classification codes",
        };
      }
    },
    listHsCodesValidation,
  )

  /**
   * GET /api/v1/invoice/resources/services-codes
   * Retrieve International Standard Industrial Classification (ISIC) service codes.
   */
  .get(
    "/services-codes",
    async ({ set }) => {
      try {
        const data = await firsService.getResource("services-codes");
        return { success: true, data };
      } catch (error: any) {
        logger.error("Failed to fetch services codes resource", {
          error: error.message,
        });
        set.status = 500;
        return {
          success: false,
          error: "Failed to retrieve ISIC service codes",
        };
      }
    },
    listServicesCodesValidation,
  )

  /**
   * GET /api/v1/invoice/resources/lgas
   * Retrieve Local Government Areas (LGAs) in Nigeria for postal address mapping.
   */
  .get(
    "/lgas",
    async ({ set }) => {
      try {
        const data = await firsService.getResource("lgas");
        return { success: true, data };
      } catch (error: any) {
        logger.error("Failed to fetch LGAs resource", {
          error: error.message,
        });
        set.status = 500;
        return {
          success: false,
          error: "Failed to retrieve Nigeria Local Government Areas",
        };
      }
    },
    listLgasValidation,
  )

  /**
   * GET /api/v1/invoice/resources/states
   * Retrieve states in Nigeria and state ISO codes for postal address mapping.
   */
  .get(
    "/states",
    async ({ set }) => {
      try {
        const data = await firsService.getResource("states");
        return { success: true, data };
      } catch (error: any) {
        logger.error("Failed to fetch states resource", {
          error: error.message,
        });
        set.status = 500;
        return {
          success: false,
          error: "Failed to retrieve Nigeria states",
        };
      }
    },
    listStatesValidation,
  )

  /**
   * GET /api/v1/invoice/resources/countries
   * Retrieve ISO 3166-1 country codes and country metadata.
   */
  .get(
    "/countries",
    async ({ set }) => {
      try {
        const data = await firsService.getResource("countries");
        return { success: true, data };
      } catch (error: any) {
        logger.error("Failed to fetch countries resource", {
          error: error.message,
        });
        set.status = 500;
        return {
          success: false,
          error: "Failed to retrieve ISO country codes",
        };
      }
    },
    listCountriesValidation,
  );

export default resourcesRoutes;
