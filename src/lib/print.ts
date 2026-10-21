/**
 * Prints a single element (receipt, brief…) through a hidden iframe that reuses the app's
 * stylesheets. Users pick "Save as PDF" in the system print dialog — this is the PDF export
 * path available without a server-side renderer.
 */
export function printElement(element: HTMLElement, title: string): Promise<void> {
  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.left = "-10000px";
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) {
      iframe.remove();
      window.print();
      resolve();
      return;
    }

    const styles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
      .map((node) => node.outerHTML)
      .join("\n");
    doc.open();
    doc.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${title}</title>${styles}
      <style>body{background:#fff!important;color:#0d0d0d!important;padding:0;margin:0}.no-print{display:none!important}.print-only{display:block!important}</style>
      </head><body>${element.outerHTML}</body></html>`);
    doc.close();

    const finish = () => {
      setTimeout(() => {
        iframe.remove();
        resolve();
      }, 500);
    };

    const go = () => {
      win.focus();
      win.addEventListener("afterprint", finish, { once: true });
      win.print();
      // Some mobile browsers never fire afterprint.
      setTimeout(finish, 60_000);
    };

    const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) fonts.ready.then(() => setTimeout(go, 150));
    else setTimeout(go, 400);
  });
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
