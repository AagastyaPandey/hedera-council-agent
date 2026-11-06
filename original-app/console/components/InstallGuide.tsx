"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { InstallApp } from "@/components/InstallApp";

type DeviceStatus = {
  origin: string;
  host: string;
  secure: boolean;
  standalone: boolean;
  serviceWorker: boolean;
};

export function InstallGuide() {
  const [status, setStatus] = useState<DeviceStatus | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const host = window.location.hostname;
      setStatus({
        origin: window.location.origin,
        host,
        secure: window.isSecureContext,
        standalone: window.matchMedia("(display-mode: standalone)").matches,
        serviceWorker: "serviceWorker" in navigator,
      });

      if ("serviceWorker" in navigator) {
        navigator.serviceWorker
          .getRegistrations()
          .then((registrations) => {
            setStatus((current) =>
              current
                ? {
                    ...current,
                    serviceWorker: registrations.some(
                      (registration) => registration.active
                    ),
                  }
                : current
            );
          })
          .catch(() => undefined);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const local =
    status?.host === "localhost" || status?.host === "127.0.0.1";
  const secure = status?.secure ?? false;
  const caUrl = status && !secure ? `http://${status.host}:3000/aegis-ca.crt` : "";
  const appUrl = status
    ? secure
      ? `${status.origin}/trail`
      : `https://${status.host}:3443/trail`
    : "";
  const installPageUrl = status
    ? secure
      ? `${status.origin}/install`
      : `https://${status.host}:3443/install`
    : "";

  return (
    <div className="doc-page">
      <aside className="doc-margin">
        <div className="doc-folio">Install</div>
        <div className="doc-folio mt-1">Android</div>
        <div className="doc-folio mt-1">PWA</div>
        <div className="mt-7 border-t border-edge pt-3">
          <div className="doc-note">Same Wi-Fi</div>
          <div className="doc-note mt-1">Local CA</div>
          <div className="doc-note mt-1">Chrome install</div>
        </div>
      </aside>

      <div className="doc-body">
        <span className="doc-folio">Android install · Aegis IntentLock</span>
        <h1 className="doc-title mt-2 text-body">Install Aegis</h1>
        <p className="doc-deck mt-4">
          {secure
            ? "This origin is trusted. Open the secure address and install the app from Chrome."
            : "Chrome installs this as a standalone Android app only from a trusted HTTPS address. Trust the local CA first, then open the secure address and install from Chrome."}
        </p>

        <section className="doc-section">
          <div className="doc-section-head">
            <h2 className="doc-section-title">This device</h2>
            <span className="doc-folio">
              {status ? status.origin : "checking…"}
            </span>
          </div>
          {status ? (
            <table className="doc-ledger">
              <tbody>
                <tr>
                  <th className="w-[150px]">Secure context</th>
                  <td className={status.secure ? "text-safe" : "text-danger"}>
                    {status.secure ? "yes" : "no"}
                  </td>
                </tr>
                <tr>
                  <th>Display</th>
                  <td>{status.standalone ? "standalone app" : "browser"}</td>
                </tr>
                <tr>
                  <th>Service worker</th>
                  <td className={status.serviceWorker ? "text-safe" : "text-signal"}>
                    {status.serviceWorker ? "active" : "not active yet"}
                  </td>
                </tr>
                <tr>
                  <th>Host</th>
                  <td className="font-mono text-[11px]">{status.host}</td>
                </tr>
              </tbody>
            </table>
          ) : null}
        </section>

        {status && !status.secure ? (
          <div className="mt-4 border-l-2 border-danger pl-3 text-[12px] leading-relaxed text-dim">
            <span className="text-danger">This is not a trusted HTTPS page.</span>{" "}
            Chrome will not offer installation here. Install the CA below, close
            Chrome, then open the secure address.
          </div>
        ) : null}

        {status && status.secure && status.standalone ? (
          <div className="mt-4 border-l-2 border-safe pl-3 text-[12px] leading-relaxed text-dim">
            <span className="text-safe">Installed.</span> You are running Aegis in
            standalone mode.
          </div>
        ) : null}

        <section className="doc-section">
          <div className="doc-section-head">
            <h2 className="doc-section-title">Steps</h2>
            <span className="doc-folio">
              {local ? "on the PC, use the phone URL" : "phone"}
            </span>
          </div>

          {local ? (
            <p className="doc-note mb-3">
              You are on the PC. Open this page on the phone using the PC’s LAN
              address. The HTTPS server printed it as{" "}
              <code>https://&lt;PC-IP&gt;:3443/install</code>.
            </p>
          ) : null}

          <ol className="list-decimal space-y-4 pl-5 text-[12.5px] leading-relaxed text-dim">
            {!secure ? (
              <li>
                <span className="text-body">Trust the local CA.</span> Download
                the certificate and install it as a CA certificate: Settings →
                Security → More security settings → Encryption &amp; credentials
                → Install a certificate → CA certificate.
                <div className="mt-2">
                  <a
                    href={caUrl}
                    download="aegis-ca.crt"
                    className="btn btn-sm"
                  >
                    Download CA certificate
                  </a>
                </div>
              </li>
            ) : null}
            <li>
              <span className="text-body">
                {secure ? "Open the secure app." : "Reopen Chrome."}
              </span>{" "}
              {secure
                ? "This origin is already trusted. Open the app and continue."
                : "Open the secure address and confirm there is no certificate warning."}
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <a href={appUrl} className="btn btn-sm btn-primary">
                  Open secure app
                </a>
                <code className="text-[10.5px] text-faint">{appUrl}</code>
              </div>
            </li>
            <li>
              <span className="text-body">Install.</span> In Chrome, use the menu
              → Install app. The Install app button appears here when Chrome
              offers installation. After installation, open Aegis from the home
              screen.
            </li>
          </ol>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <InstallApp showGuideLink={false} />
            <Link
              href="/docs"
              className="underline decoration-danger/40 underline-offset-2 text-[11px] text-dim hover:text-danger"
            >
              Back to docs
            </Link>
          </div>
          {status?.secure && !status.standalone ? (
            <p className="doc-note mt-3">
              If the button is not there, use Chrome’s menu. If “Install app” is
              missing, the certificate is still not trusted or the page is not
              the secure{" "}
              <code>{installPageUrl || "https://<PC-IP>:3443/install"}</code>{" "}
              address.
            </p>
          ) : null}
        </section>

        <section className="doc-section">
          <h2 className="doc-section-title">After installation</h2>
          <p className="doc-note max-w-[68ch]">
            The narrative records are cached and work offline. The Live section
            needs the PC and the Hardhat node to stay running while this address
            is open. The app is tied to this HTTPS origin; if the address
            changes, install it again from the new address.
          </p>
        </section>
      </div>
    </div>
  );
}
