import { NextResponse } from "next/server";

import { getBasDocumentInvoice } from "@/lib/bas-api";
import { renderInvoiceHtml } from "@/lib/inventory-invoice-html";
import { renderInvoicePdf } from "@/lib/inventory-invoice-pdf";

export const runtime = "nodejs";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const refKey = searchParams.get("refKey")?.trim() ?? "";
  const format = searchParams.get("format") === "html" ? "html" : "pdf";

  if (type !== "receipt" && type !== "sale" && type !== "production") {
    return NextResponse.json(
      { error: "type має бути receipt, sale або production" },
      { status: 400 }
    );
  }

  if (!UUID_RE.test(refKey)) {
    return NextResponse.json({ error: "Некоректний refKey" }, { status: 400 });
  }

  try {
    const invoice = await getBasDocumentInvoice(type, refKey);
    const baseName = `Накладна_${invoice.number}_${invoice.date || "doc"}`;

    if (format === "html") {
      const html = renderInvoiceHtml(invoice);
      return new NextResponse(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(`${baseName}.html`)}`,
          "Cache-Control": "no-store",
        },
      });
    }

    const pdf = await renderInvoicePdf(invoice);
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${baseName}.pdf`)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Помилка формування накладної",
      },
      { status: 500 }
    );
  }
}
