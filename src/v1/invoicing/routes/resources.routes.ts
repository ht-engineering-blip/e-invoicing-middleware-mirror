import Elysia from "elysia";
import { FIRSService } from "../../../@lib/adapters/firs/firs.service";
import {
  listPaymentMeansValidation,
  listTaxCategoriesValidation,
  listCurrenciesValidation,
  listQuantityCodesValidation,
  listHsCodesValidation,
  listServicesCodesValidation,
  listLgasValidation,
  listStatesValidation,
  listCountriesValidation,
} from "../validations/resources.validation";

const firsService = new FIRSService();

const resourcesRoutes = new Elysia({ prefix: "/invoice/resources" })
  .get(
    "/payment_means",
    async () => ({
      success: true,
      data: await firsService.getResource("payment-means"),
    }),
    listPaymentMeansValidation,
  )
  .get(
    "/tax-categories",
    async () => ({
      success: true,
      data: await firsService.getResource("tax-categories"),
    }),
    listTaxCategoriesValidation,
  )
  .get(
    "/currencies",
    async () => ({
      success: true,
      data: await firsService.getResource("currencies"),
    }),
    listCurrenciesValidation,
  )
  .get(
    "/invoice-quantity-codes",
    async () => ({
      success: true,
      data: await firsService.getResource("invoice-quantity-codes"),
    }),
    listQuantityCodesValidation,
  )
  .get(
    "/hs-codes",
    async () => ({
      success: true,
      data: await firsService.getResource("hs-codes"),
    }),
    listHsCodesValidation,
  )
  .get(
    "/services-codes",
    async () => ({
      success: true,
      data: await firsService.getResource("services-codes"),
    }),
    listServicesCodesValidation,
  )
  .get(
    "/lgas",
    async () => ({
      success: true,
      data: await firsService.getResource("lgas"),
    }),
    listLgasValidation,
  )
  .get(
    "/states",
    async () => ({
      success: true,
      data: await firsService.getResource("states"),
    }),
    listStatesValidation,
  )
  .get(
    "/countries",
    async () => ({
      success: true,
      data: await firsService.getResource("countries"),
    }),
    listCountriesValidation,
  );

export default resourcesRoutes;
