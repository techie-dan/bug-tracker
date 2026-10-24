import { prisma } from "@/lib/prisma";
import { isTwoFactorEnabled } from "@/lib/two-factor";

/**
 * A password account with two-factor on must not be opened by Google alone
 * (#388). New addresses, and accounts that never turned two-factor on, are
 * unaffected. The password form still asks for the code.
 */
export async function googleSignInBlockedByTwoFactor(email: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true },
  });
  if (!user) return false;
  return isTwoFactorEnabled(user.id);
}
