import { CredentialsSignin } from "next-auth";

/**
 * Sign-in errors for the second step (#648). They are only thrown after the
 * password has been checked, so they do not reveal whether an account exists.
 * `code` is what the login action reads; Auth.js also puts it in the URL when
 * the credentials callback is posted to directly.
 */
export class TwoFactorRequiredError extends CredentialsSignin {
  code = "two_factor_required";
}

export class TwoFactorInvalidError extends CredentialsSignin {
  code = "two_factor_invalid";
}
