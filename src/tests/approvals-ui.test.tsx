import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import Approvals from "@/pages/Approvals";
import ReviewWorkspace from "@/pages/archive/ReviewWorkspace";
import { getDB, commit } from "@/services/db";
import { proposeOperation } from "@/services/approvals";
import { switchDemoUser } from "@/services/api";
import { createBatch, createItem } from "@/services/archive/service";

function renderApprovals() {
  return render(
    <MemoryRouter initialEntries={["/app/approvals"]}>
      <Routes>
        <Route path="/app/approvals" element={<Approvals />} />
        <Route path="*" element={<div>صفحة أخرى</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

const hearingParams = { caseId: "1", court: "قصر العدالة بتونس", room: "قاعة 3", type: "جلسة مرافعة", date: "2026-11-11", time: "10:00" };

describe("«طلبات الموافقة» page", () => {
  it("lets an authorised lawyer approve and execute, showing the verified result", async () => {
    switchDemoUser("u3");
    proposeOperation("hearing.create", hearingParams, { via: "assistant" });
    switchDemoUser("u1");
    renderApprovals();
    const user = userEvent.setup();
    const card = screen.getByRole("region", { name: /طلب موافقة/ });
    expect(within(card).getByText("في انتظار الموافقة")).toBeInTheDocument();
    expect(within(card).getByText(/اقتراح من المساعد/)).toBeInTheDocument();
    const before = getDB().hearings.length;
    await user.click(within(card).getByRole("button", { name: "تأكيد العملية" }));
    expect(getDB().hearings.length).toBe(before + 1);
    await user.click(screen.getByRole("tab", { name: /منفّذة/ }));
    expect(await screen.findByText(/تمت برمجة جلسة مرافعة/)).toBeInTheDocument();
  });

  it("shows no decision buttons to a clerk and lets the lawyer edit then reject", async () => {
    proposeOperation("hearing.create", hearingParams, { via: "assistant" });
    switchDemoUser("u3");
    const { unmount } = renderApprovals();
    const card = screen.getByRole("region", { name: /طلب موافقة/ });
    expect(within(card).queryByRole("button", { name: "تأكيد العملية" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "رفض العملية" })).toBeNull();
    unmount();

    switchDemoUser("u1");
    renderApprovals();
    const user = userEvent.setup();
    const lawyerCard = screen.getByRole("region", { name: /طلب موافقة/ });
    await user.click(within(lawyerCard).getByRole("button", { name: "تعديل المقترح" }));
    const time = within(lawyerCard).getByLabelText("الساعة");
    await user.clear(time);
    await user.type(time, "11:30");
    await user.click(within(lawyerCard).getByRole("button", { name: "حفظ المقترح المعدّل" }));
    const revised = getDB().approvals[0];
    expect(revised.revision).toBe(2);
    expect(revised.params.time).toBe("11:30");
    await user.click(within(screen.getByRole("region", { name: /طلب موافقة/ })).getByRole("button", { name: "رفض العملية" }));
    await user.type(screen.getByLabelText("سبب الرفض (اختياري)"), "الموعد غير مناسب");
    await user.click(screen.getByRole("button", { name: "تأكيد الرفض" }));
    expect(getDB().approvals[0].status).toBe("rejected");
    expect(getDB().hearings.some((h) => h.time === "11:30" && h.date === "2026-11-11")).toBe(false);
  });

  it("shows an intact audit chain", async () => {
    proposeOperation("hearing.create", hearingParams, { via: "assistant" });
    renderApprovals();
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: /سجل التدقيق/ }));
    expect(await screen.findByText(/سلسلة السجل سليمة/)).toBeInTheDocument();
  });
});

describe("mobile document verification", () => {
  it("renders the review screen with stacked fields and a persistent action bar on a phone", async () => {
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({ ...original(q), matches: /max-width|pointer: coarse/.test(q) })) as typeof window.matchMedia;
    try {
      const b = createBatch({ name: "دفعة", reference: "ARC-M-1", location: "العلبة", responsibleId: "u3" });
      if (!b.ok) throw new Error(b.error);
      const it1 = createItem(b.data.id, { name: "hokm.jpg", type: "image/jpeg", size: 10 });
      if (!it1.ok) throw new Error(it1.error);
      commit((d) => ({
        ...d,
        archiveItems: d.archiveItems.map((i) =>
          i.id === it1.data.id
            ? {
                ...i,
                state: "review" as const,
                pages: [
                  {
                    id: "p1",
                    index: 0,
                    originalKey: "orig:x",
                    rotation: 0 as const,
                    quality: { analyzed: true },
                    ocr: { engine: "t", text: "حكم بتاريخ 12 جوان 2019", confidence: 50, lang: "ar" as const, uncertain: ["جوان"], at: "" },
                  },
                ],
                fields: [{ key: "date" as const, label: "التاريخ", value: "2019-06-12", confidence: 45, source: "rule" as const, evidence: "12 جوان 2019", page: 1 }],
                classification: { suggested: "judgment" as const, confidence: 70, evidence: ["مؤشرات"] },
              }
            : i,
        ),
      }));
      render(
        <MemoryRouter initialEntries={[`/app/archive/batches/${b.data.id}/review/${it1.data.id}`]}>
          <Routes>
            <Route path="/app/archive/batches/:batchId/review/:itemId" element={<ReviewWorkspace />} />
          </Routes>
        </MemoryRouter>,
      );
      expect(screen.getByRole("button", { name: "عرض بملء الشاشة" })).toBeInTheDocument();
      expect(screen.getByLabelText("التاريخ")).toHaveValue("2019-06-12");
      expect(screen.getAllByText(/غير مؤكد/).length).toBeGreaterThan(0);
      const approve = screen.getByRole("button", { name: /اعتماد البيانات/ });
      expect(approve).toBeDisabled();
      const user = userEvent.setup();
      await user.click(screen.getByRole("checkbox"));
      expect(approve).toBeEnabled();
      await user.click(approve);
      expect(getDB().archiveItems.find((i) => i.id === it1.data.id)?.state).toBe("pending_approval");
      expect(await screen.findByRole("region", { name: /طلب موافقة/ })).toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });
});
