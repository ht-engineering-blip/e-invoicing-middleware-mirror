import { ForbiddenError, UnauthorizedError } from "../../../@lib";
import { AuthContext } from "../../../middlewares";

export const onlySelf = (auth: AuthContext, tenantId: string) =>{
     // Verify the user has access to this tenant
        if (auth?.tenantId !== tenantId && !auth?.isAdmin) {
          throw new ForbiddenError('Forbidden: You do not have access to this tenant')
        }

}
export const onlyAdmin = (auth: AuthContext , customMessage?: string) =>{
     // Verify the user has access to this tenant
        if (!auth?.isAdmin) {
          throw new ForbiddenError(customMessage||'Forbidden: You do not have access to this tenant')
        }

}