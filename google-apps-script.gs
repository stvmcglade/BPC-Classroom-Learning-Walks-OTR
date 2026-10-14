const SCRIPT_VERSION = "2026-10-14-duplicate-protection";
const DRIVE_FOLDER_ID = "1YThYqaqnVbZbjAODNoH35mGtoLw6fFLG";
const SENDER_NAME = "Classroom Learning Walks";
const EMAIL_SUBJECT_PREFIX = "Classroom Learning Walks CSV Export";

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({
      ok: true,
      version: SCRIPT_VERSION,
      method: "GET"
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let lock;
  try {
    const recipientEmail = String((e.parameter && e.parameter.recipientEmail) || "").trim().toLowerCase();
    const csvContent = String((e.parameter && e.parameter.csvContent) || "");
    const recordCount = String((e.parameter && e.parameter.recordCount) || "0").trim();

    if (!recipientEmail) {
      throw new Error("Missing recipient email address.");
    }

    if (!csvContent) {
      throw new Error("Missing CSV content.");
    }

    assertObserverAccount_(recipientEmail);

    const observationId = String(e.parameter.observationId || "").trim().toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(observationId)) {
      throw new Error("This observation page needs updating before uploading. Keep your downloaded CSV and use the latest webpage files. No file was saved or emailed.");
    }

    lock = LockService.getUserLock();
    if (!lock.tryLock(10000)) {
      throw new Error("Another export is still processing. Wait for its Google window to finish before retrying.");
    }
    const exportKey = hashText_(recipientEmail + "\n" + observationId);
    const folder = DRIVE_FOLDER_ID ? DriveApp.getFolderById(DRIVE_FOLDER_ID) : DriveApp.getRootFolder();
    const finalFilename = "classroom-learning-walks-" + exportKey + ".csv";
    const properties = PropertiesService.getUserProperties();
    const recent = JSON.parse(properties.getProperty("recentWalkExports") || "[]");
    const previous = recent.find((entry) => entry.key === exportKey);
    const matches = previous ? null : folder.getFilesByName(finalFilename);
    const existingFile = previous ? DriveApp.getFileById(previous.id) : matches.hasNext() ? matches.next() : null;

    if (existingFile) {
      if (existingFile.getBlob().getDataAsString("UTF-8") !== csvContent) {
        return buildHtmlResponse_({ ok: false, driveUrl: existingFile.getUrl(), error: "This observation was already uploaded with different contents. Your changes have not overwritten the original, and no extra file or email was created. Keep your updated downloaded CSV and contact the report administrator to replace the original if needed." });
      }
      const emailed = existingFile.getDescription() === "Learning Walk export: email sent";
      return buildHtmlResponse_({ ok: true, emailUnconfirmed: !emailed, recipientEmail, recordCount, finalFilename, driveUrl: existingFile.getUrl(),
        summary: emailed ? "This observation was already saved and emailed. No duplicate file or email was created." : "This observation is already saved in Drive. Email delivery is unconfirmed; no duplicate file or email was created. Use the Drive copy below." });
    }

    const csvBlob = Utilities.newBlob(csvContent, "text/csv", finalFilename);
    const driveFile = folder.createFile(csvBlob.copyBlob());
    // Remember the file before email delivery; retries must never create a second copy.
    recent.unshift({ key: exportKey, id: driveFile.getId() });
    properties.setProperty("recentWalkExports", JSON.stringify(recent.slice(0, 40)));
    driveFile.setDescription("Learning Walk export: email delivery unconfirmed");

    let emailSent = false;
    try {
      MailApp.sendEmail({
      to: recipientEmail,
      subject: EMAIL_SUBJECT_PREFIX,
      body:
        "Your Classroom Learning Walks CSV export is attached.\n\n" +
        "Walkthroughs included: " + recordCount + "\n" +
        "Saved filename: " + finalFilename + "\n" +
        "Drive copy: " + driveFile.getUrl(),
      attachments: [csvBlob],
      name: SENDER_NAME
      });
      emailSent = true;
      driveFile.setDescription("Learning Walk export: email sent");
    } catch (emailError) {
      // A send can succeed before an error is returned. Do not automatically resend.
    }

    return buildHtmlResponse_({
      ok: true,
      emailUnconfirmed: !emailSent,
      recipientEmail,
      recordCount,
      finalFilename,
      driveUrl: driveFile.getUrl(),
      summary: emailSent ? "The CSV was emailed and saved to Google Drive successfully." : "The CSV was saved to Google Drive, but email delivery is unconfirmed. Use the Drive copy below; exporting again will not create or email another copy."
    });
  } catch (error) {
    return buildHtmlResponse_({
      ok: false,
      error: error && error.message ? error.message : String(error)
    });
  } finally {
    if (lock && lock.hasLock()) lock.releaseLock();
  }
}

function hashText_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map((byte) => (byte & 255).toString(16).padStart(2, "0")).join("");
}

function assertObserverAccount_(observerEmail) {
  if (!/^[^\s@]+@buckleyparkco\.vic\.edu\.au$/.test(observerEmail)) {
    throw new Error("Use your own @buckleyparkco.vic.edu.au email address. No file was saved or emailed.");
  }

  // Trust Google's authenticated identity, never an account hint from the form.
  const activeEmail = String(Session.getActiveUser().getEmail() || "").trim().toLowerCase();
  const effectiveEmail = String(Session.getEffectiveUser().getEmail() || "").trim().toLowerCase();
  if (!activeEmail || !effectiveEmail) {
    throw new Error("Google could not verify your signed-in email. No file was saved or emailed. Return to the observation form and retry in a browser signed in only as " + observerEmail + ".");
  }
  if (activeEmail !== observerEmail) {
    throw new Error("The signed-in Google account does not match " + observerEmail + ". No file was saved or emailed. Switch to that school account, return to the observation form and export again. If Google keeps choosing another account, use a separate browser profile signed in only to your school account.");
  }
  if (effectiveEmail !== activeEmail) {
    throw new Error("The upload is not running as the signed-in observer. No file was saved or emailed. Ask the administrator to deploy this web app to execute as the user accessing it.");
  }
}

function buildHtmlResponse_(payload) {
  const title = payload.ok ? payload.emailUnconfirmed ? "CSV Saved to Drive" : "CSV Export Complete" : "CSV Export Failed";
  const accentColor = payload.ok ? "#0f766e" : "#b42318";
  const summary = payload.summary || (payload.ok
    ? "The CSV was emailed and saved to Google Drive successfully."
    : "Google Apps Script could not complete the export.");

  const details = payload.ok
    ? [
        `<p><strong>Recipient:</strong> ${escapeHtml_(payload.recipientEmail)}</p>`,
        `<p><strong>Walkthroughs included:</strong> ${escapeHtml_(payload.recordCount)}</p>`,
        `<p><strong>Saved filename:</strong> ${escapeHtml_(payload.finalFilename)}</p>`,
        `<p><a class="button" href="${payload.driveUrl}" target="_blank" rel="noopener noreferrer">Open the Drive copy</a></p>`,
        "<p class=\"hint\">You can close this window and return to the form.</p>"
      ].join("")
    : [
        `<p><strong>Issue:</strong> ${escapeHtml_(payload.error || "Unknown error.")}</p>`,
        payload.driveUrl ? `<p><a class="button" href="${escapeHtml_(payload.driveUrl)}" target="_blank" rel="noopener noreferrer">Open the existing Drive copy</a></p>` : "",
        "<p class=\"hint\">Please keep this window open and share the message above if you need help troubleshooting.</p>"
      ].join("");

  const html = [
    "<!DOCTYPE html>",
    "<html lang=\"en\">",
    "<head>",
    "<meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
    `<title>${escapeHtml_(title)}</title>`,
    "<style>",
    "body{margin:0;padding:32px;font-family:Arial,sans-serif;background:#f4f7f6;color:#172026;}",
    ".card{max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #d8e2e0;border-radius:22px;padding:28px 30px;box-shadow:0 20px 50px rgba(23,32,38,0.08);}",
    `.eyebrow{margin:0 0 10px;color:${accentColor};font-size:0.78rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;}`,
    "h1{margin:0 0 12px;font-size:1.85rem;line-height:1.1;color:#102a2c;}",
    "p{margin:0 0 12px;line-height:1.6;}",
    ".summary{font-size:1.02rem;color:#33555b;}",
    ".button{display:inline-block;padding:12px 18px;border-radius:999px;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:700;}",
    ".hint{margin-top:18px;color:#5d6f73;font-size:0.94rem;}",
    ".meta{margin-top:18px;padding-top:16px;border-top:1px solid #e3ebea;color:#667b7f;font-size:0.88rem;}",
    "</style>",
    "</head>",
    "<body>",
    "<div class=\"card\">",
    `<p class="eyebrow">${payload.ok ? payload.emailUnconfirmed ? "Email Unconfirmed" : "Export Successful" : "Export Failed"}</p>`,
    `<h1>${escapeHtml_(title)}</h1>`,
    `<p class="summary">${escapeHtml_(summary)}</p>`,
    details,
    `<p class="meta">Script version: ${escapeHtml_(SCRIPT_VERSION)}</p>`,
    "</div>",
    "</body>",
    "</html>"
  ].join("");

  return HtmlService.createHtmlOutput(html)
    .setTitle(title)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function escapeHtml_(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
