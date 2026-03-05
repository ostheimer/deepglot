import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { z } from "zod";

const schema = z.object({
  billingName: z.string().max(200).optional(),
  address: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  zip: z.string().max(20).optional(),
  country: z.string().length(2).optional(),
  vatNumber: z.string().max(50).optional(),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Nicht autorisiert" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Eingabe" }, { status: 400 });
  }

  const { billingName, address, city, zip, country, vatNumber } = parsed.data;

  const membership = await db.organizationMember.findFirst({
    where: { userId: session.user.id },
    include: { organization: { include: { subscription: true } } },
  });

  const customerId = membership?.organization?.subscription?.stripeCustomerId;
  if (!customerId) {
    return NextResponse.json({ success: true }); // no Stripe customer yet, silently succeed
  }

  await stripe.customers.update(customerId, {
    name: billingName,
    address: {
      line1: address ?? "",
      city: city ?? "",
      postal_code: zip ?? "",
      country: country ?? "AT",
    },
    ...(vatNumber && { tax_id_data: undefined }), // VAT handled separately via tax IDs
  });

  return NextResponse.json({ success: true });
}
