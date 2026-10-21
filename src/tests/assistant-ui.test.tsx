import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import Assistant, { SUGGESTED_PROMPTS } from "@/pages/Assistant";
import { AssistantProviderContext, DemoAssistantProvider, type AssistantProvider } from "@/services/assistant/provider";
import { getDB } from "@/services/db";
import { updatePrefs } from "@/services/api";

function renderAssistant(provider: AssistantProvider = new DemoAssistantProvider({ wordDelayMs: 0, thinkMs: 0 }), url = "/app/assistant") {
  return render(
    <AssistantProviderContext.Provider value={provider}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/app/assistant" element={<Assistant />} />
          <Route path="*" element={<div>صفحة أخرى</div>} />
        </Routes>
      </MemoryRouter>
    </AssistantProviderContext.Provider>,
  );
}

async function sendMessage(text: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("اكتب رسالتك للمساعد"), text);
  await user.click(screen.getByRole("button", { name: "إرسال" }));
  return user;
}

describe("assistant conversation", () => {
  it("shows the six suggested prompts in Arabic", () => {
    renderAssistant();
    for (const p of SUGGESTED_PROMPTS) expect(screen.getByRole("button", { name: p })).toBeInTheDocument();
    expect(screen.getByText(/لا يقدّم استشارة قانونية معتمدة/)).toBeInTheDocument();
  });

  it("previews a hearing, writes nothing until confirmed, then shows the verified result", async () => {
    renderAssistant();
    const before = getDB().hearings.length;
    const user = await sendMessage("سجّللي جلسة نهار 11 نوفمبر مع ملف عائلة بن صالح على الساعة 10");

    const confirm = await screen.findByRole("button", { name: "تأكيد العملية" });
    expect(screen.getByText("بانتظار تأكيدك")).toBeInTheDocument();
    expect(getDB().hearings.length).toBe(before);

    await user.click(confirm);
    expect(await screen.findByText("تم الحفظ")).toBeInTheDocument();
    expect(getDB().hearings.length).toBe(before + 1);
    expect(screen.getByText(/تم التحقق من الحفظ/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "فتح" })).toHaveAttribute("href", "/app/cases/1");
  });

  it("cancelling a preview saves nothing", async () => {
    renderAssistant();
    const before = getDB().tasks.length;
    const user = await sendMessage("اعمل تذكير باش نكلّم الحريف نهار الجمعة");
    await user.click(await screen.findByRole("button", { name: "رفض العملية" }));
    expect(await screen.findByText("رُفضت العملية — لم يُحفظ شيء")).toBeInTheDocument();
    expect(getDB().tasks.length).toBe(before);
  });

  it("keeps confirmation disabled while required fields are missing", async () => {
    renderAssistant();
    await sendMessage("سجّللي جلسة نهار 11 نوفمبر مع ملف عائلة بن صالح");
    expect(await screen.findByRole("button", { name: "تأكيد العملية" })).toBeDisabled();
    expect(screen.getByText(/حقول مطلوبة: الساعة/)).toBeInTheDocument();
  });

  it("renders clickable citations for archive answers", async () => {
    renderAssistant();
    await sendMessage("فتّشلي على حكم قديم في نزاع ميراث");
    const links = await screen.findAllByRole("link", { name: /فتح المصدر/ });
    expect(links[0].getAttribute("href")).toMatch(/^\/app\/document\/a1\?page=\d+/);
  });

  it("shows an error with retry when the provider fails, without claiming any action", async () => {
    const failing: AssistantProvider = {
      id: "failing",
      label: "failing",
      simulated: false,
      // eslint-disable-next-line require-yield
      async *send() {
        throw new Error("network down");
      },
    };
    renderAssistant(failing);
    await sendMessage("شنوة الجلسات اللي عندي الأسبوع الجاي؟");
    expect(await screen.findByText(/تعذّر الحصول على رد من المساعد/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إعادة توليد الرد" })).toBeInTheDocument();
  });

  it("can stop a streaming response", async () => {
    renderAssistant(new DemoAssistantProvider({ wordDelayMs: 200, thinkMs: 0 }));
    const user = await sendMessage("شنوة الجلسات اللي عندي الأسبوع الجاي؟");
    await user.click(await screen.findByRole("button", { name: "إيقاف التوليد" }));
    expect(await screen.findByText(/تم إيقاف التوليد/)).toBeInTheDocument();
  });
});

// ——— Voice ———

type Handler = ((e: unknown) => void) | null;
class MockRecognition {
  static last: MockRecognition | null = null;
  lang = "";
  continuous = false;
  interimResults = false;
  onresult: Handler = null;
  onerror: Handler = null;
  onend: (() => void) | null = null;
  constructor() {
    MockRecognition.last = this;
  }
  start() {}
  stop() {
    this.onend?.();
  }
  abort() {}
  emitFinal(text: string) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text } }] });
  }
}

describe("voice dictation", () => {
  const w = window as unknown as { webkitSpeechRecognition?: unknown };
  beforeEach(() => {
    delete w.webkitSpeechRecognition;
  });
  afterEach(() => {
    delete w.webkitSpeechRecognition;
  });

  it("reports unsupported browsers instead of pretending to transcribe", async () => {
    renderAssistant();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "إملاء صوتي" }));
    expect(await screen.findByText(/متصفحك لا يدعم التعرّف على الصوت/)).toBeInTheDocument();
  });

  it("requires consent before using the browser speech service", async () => {
    w.webkitSpeechRecognition = MockRecognition;
    renderAssistant();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "إملاء صوتي" }));
    expect(await screen.findByText(/الإملاء الصوتي غير مهيأ/)).toBeInTheDocument();
    const enable = screen.getByRole("button", { name: /تفعيل الإملاء عبر المتصفح/ });
    expect(enable).toBeDisabled();
  });

  it("shows the transcript for review and only sends after the user confirms", async () => {
    w.webkitSpeechRecognition = MockRecognition;
    updatePrefs({ voiceProvider: "browser", browserVoiceConsent: true });
    renderAssistant();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "إملاء صوتي" }));
    expect(await screen.findByText("جارٍ الاستماع...")).toBeInTheDocument();

    MockRecognition.last!.emitFinal("شنوة الجلسات اللي عندي غدوة");
    await user.click(screen.getByRole("button", { name: /إنهاء/ }));

    const review = await screen.findByLabelText(/راجع النص المكتوب/);
    expect(review).toHaveValue("شنوة الجلسات اللي عندي غدوة");
    expect(getDB().conversations).toHaveLength(0);

    await user.click(within(screen.getByRole("region", { name: "الإملاء الصوتي" })).getByRole("button", { name: /إرسال/ }));
    await waitFor(() => expect(screen.getByLabelText("رسالتك")).toHaveTextContent("شنوة الجلسات اللي عندي غدوة"));
    expect(screen.getByLabelText("عبر الإملاء الصوتي")).toBeInTheDocument();
  });

  it("handles microphone permission denial with a retry option", async () => {
    w.webkitSpeechRecognition = MockRecognition;
    updatePrefs({ voiceProvider: "browser", browserVoiceConsent: true });
    renderAssistant();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "إملاء صوتي" }));
    MockRecognition.last!.onerror?.({ error: "not-allowed" });
    expect(await screen.findByText(/تم رفض الوصول إلى الميكروفون/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /إعادة المحاولة/ })).toBeInTheDocument();
  });

  it("cancelling a recording discards it and sends nothing", async () => {
    w.webkitSpeechRecognition = MockRecognition;
    updatePrefs({ voiceProvider: "browser", browserVoiceConsent: true });
    renderAssistant();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "إملاء صوتي" }));
    MockRecognition.last!.emitFinal("نص لا يجب إرساله");
    await user.click(screen.getByRole("button", { name: /إلغاء/ }));
    expect(screen.queryByRole("region", { name: "الإملاء الصوتي" })).not.toBeInTheDocument();
    expect(screen.queryByText("نص لا يجب إرساله")).not.toBeInTheDocument();
    expect(getDB().conversations).toHaveLength(0);
  });

  it("reports when no speech was captured", async () => {
    w.webkitSpeechRecognition = MockRecognition;
    updatePrefs({ voiceProvider: "browser", browserVoiceConsent: true });
    renderAssistant();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "إملاء صوتي" }));
    await user.click(screen.getByRole("button", { name: /إنهاء/ }));
    expect(await screen.findByText(/لم يُلتقط أي كلام/)).toBeInTheDocument();
  });
});


describe("approval workflow in the chat", () => {
  it("shows the approval card sections and routes a clerk's request to a lawyer", async () => {
    const { switchDemoUser } = await import("@/services/api");
    switchDemoUser("u3");
    renderAssistant();
    const before = getDB().hearings.length;
    const user = await sendMessage("سجّللي جلسة نهار 11 نوفمبر مع ملف عائلة بن صالح على الساعة 10");
    const card = await screen.findByRole("region", { name: /طلب موافقة/ });
    for (const label of ["العملية المقترحة", "الملف المعني", "التفاصيل", "التغييرات المقترحة", "الشخص المخوّل بالموافقة"]) {
      expect(within(card).getByText(label)).toBeInTheDocument();
    }
    expect(within(card).getByRole("button", { name: "تعديل المقترح" })).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "إرسال للموافقة" }));
    expect(await screen.findByText(/أُرسل الطلب إلى/)).toBeInTheDocument();
    expect(getDB().hearings.length).toBe(before);
    const request = getDB().approvals[0];
    expect(request).toMatchObject({ status: "pending", proposedVia: "assistant", proposedBy: "u3" });
    expect(request.approverRoles).not.toContain("secretary");
  });
});
