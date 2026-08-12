/* WILP QA Portal — production frontend (MVP scope: auth + audit workflow).
 * Talks to real Netlify Functions under /api/*, session is an httpOnly cookie the browser
 * sends automatically — this file never touches a password or token directly. Unlike the
 * old localStorage demo, role checks here are just for hiding UI; the server is what
 * actually enforces them, so there is nothing to "cheat" via devtools anymore.
 */
(function () {
  "use strict";

  var state = { user: null, meta: null };

  function el(html) {
    var t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtDateTime(s) { return s ? String(s).replace("T", " ").slice(0, 16) : ""; }
  function toast(msg, isError) {
    var box = document.getElementById("toast-box");
    if (!box) return;
    var t = el('<div class="card px-4 py-2 mb-2 shadow ' + (isError ? "border-red-300 text-red-700" : "border-green-300 text-green-700") + '">' + escapeHtml(msg) + "</div>");
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, 4000);
  }

  async function api(path, options) {
    options = options || {};
    var opts = Object.assign({ credentials: "same-origin", headers: { "content-type": "application/json" } }, options);
    if (opts.body && typeof opts.body !== "string") opts.body = JSON.stringify(opts.body);
    var res;
    try {
      res = await fetch(path, opts);
    } catch (e) {
      throw new Error("Network error reaching the server. Check your connection and try again.");
    }
    var data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) throw new Error((data && data.error) || "Request failed (" + res.status + ").");
    return data;
  }

  var RATING_COLORS = { Excellent: "bg-green-100 text-green-800", Good: "bg-blue-100 text-blue-800", "Needs Improvement": "bg-amber-100 text-amber-800", Poor: "bg-red-100 text-red-800", "FAIL - ZTP": "bg-red-200 text-red-900" };
  function ratingLabel(finalResultCode) {
    var map = { EXCELLENT: "Excellent", GOOD: "Good", NEEDS_IMPROVEMENT: "Needs Improvement", POOR: "Poor", FAIL_ZTP: "FAIL - ZTP" };
    return map[finalResultCode] || finalResultCode || "—";
  }
  function ratingBadge(finalResultCode) {
    var label = ratingLabel(finalResultCode);
    var cls = RATING_COLORS[label] || "bg-gray-100 text-gray-700";
    return '<span class="badge ' + cls + '">' + escapeHtml(label) + "</span>";
  }

  var QA_AND_ABOVE = ["ADMIN", "QA_ANALYST"];
  function hasRole(user, roles) { return !!user && roles.indexOf(user.role) !== -1; }

  // ---------------- Shell / router ----------------
  function shellHtml(inner) {
    var user = state.user;
    return (
      '<div class="min-h-screen">' +
      '<div class="bg-white border-b sticky top-0 z-10">' +
      '<div class="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">' +
      '<div class="flex items-center gap-6">' +
      '<a href="#/" class="font-bold text-lg text-blue-800">WILP QA Portal</a>' +
      '<a href="#/audits" class="text-sm text-gray-600 hover:text-blue-700">Audits</a>' +
      (hasRole(user, QA_AND_ABOVE) ? '<a href="#/audits/new" class="text-sm text-gray-600 hover:text-blue-700">New Audit</a>' : "") +
      "</div>" +
      '<div class="flex items-center gap-3 text-sm">' +
      '<span class="text-gray-500">' + escapeHtml(user.name) + " · " + escapeHtml(user.role) + "</span>" +
      '<button id="logout-btn" class="btn btn-secondary">Sign out</button>' +
      "</div></div></div>" +
      '<div id="toast-box" class="fixed top-16 right-4 z-50 w-80"></div>' +
      '<div class="max-w-6xl mx-auto px-4 py-6">' + inner + "</div>" +
      "</div>"
    );
  }

  function render(html) { document.getElementById("app").innerHTML = html; }

  async function afterRouteRender(route) {
    var logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) logoutBtn.addEventListener("click", async function () {
      try { await api("/api/auth/login".replace("login", "logout"), { method: "POST" }); } catch (e) {}
      state.user = null;
      location.hash = "#/login";
      boot();
    });
    if (route === "audits-list") await mountAuditsList();
    else if (route === "audits-new") await mountNewAuditForm();
    else if (route.indexOf("audit-detail:") === 0) await mountAuditDetail(route.split(":")[1]);
  }

  async function router() {
    var hash = location.hash || "#/";
    if (!state.user) {
      render(loginHtml());
      mountLoginForm();
      return;
    }
    var path = hash.replace(/^#/, "");
    if (path === "/" || path === "") {
      render(shellHtml(dashboardHtml()));
    } else if (path === "/audits") {
      render(shellHtml('<div id="audits-list-mount">Loading…</div>'));
      await afterRouteRender("audits-list");
    } else if (path === "/audits/new") {
      if (!hasRole(state.user, QA_AND_ABOVE)) { render(shellHtml('<div class="card p-6">Only QA analysts and admins can create audits.</div>')); return; }
      render(shellHtml('<div id="new-audit-mount">Loading…</div>'));
      await afterRouteRender("audits-new");
    } else if (/^\/audits\/\d+$/.test(path)) {
      var id = path.split("/")[2];
      render(shellHtml('<div id="audit-detail-mount">Loading…</div>'));
      await afterRouteRender("audit-detail:" + id);
    } else {
      render(shellHtml('<div class="card p-6">Not found.</div>'));
    }
  }

  function dashboardHtml() {
    var user = state.user;
    return (
      '<div class="card p-6 mb-4">' +
      '<h1 class="text-xl font-bold mb-1">Welcome, ' + escapeHtml(user.name) + "</h1>" +
      '<p class="text-sm text-gray-600">Role: ' + escapeHtml(user.role) + (user.team ? " · Team " + escapeHtml(user.team) : "") + "</p>" +
      "</div>" +
      '<div class="grid sm:grid-cols-2 gap-4">' +
      '<a href="#/audits" class="card p-5 hover:shadow transition block">' +
      '<div class="font-semibold mb-1">Audits</div><div class="text-sm text-gray-600">Browse and review call audits.</div></a>' +
      (hasRole(user, QA_AND_ABOVE)
        ? '<a href="#/audits/new" class="card p-5 hover:shadow transition block">' +
          '<div class="font-semibold mb-1">New Audit</div><div class="text-sm text-gray-600">Score a call and submit an audit.</div></a>'
        : "") +
      "</div>"
    );
  }

  // ---------------- Login ----------------
  function loginHtml() {
    return (
      '<div class="min-h-screen flex items-center justify-center px-4">' +
      '<div class="card p-8 w-full max-w-sm">' +
      '<h1 class="text-lg font-bold mb-1">WILP QA Portal</h1>' +
      '<p class="text-sm text-gray-500 mb-5">Sign in to continue</p>' +
      '<form id="login-form" class="space-y-3">' +
      '<div><label class="field-label">Email</label><input name="email" type="email" class="input" required autofocus /></div>' +
      '<div><label class="field-label">Password</label><input name="password" type="password" class="input" required /></div>' +
      '<div id="login-error" class="text-sm text-red-600 hidden"></div>' +
      '<button type="submit" class="btn btn-primary w-full">Sign in</button>' +
      "</form></div></div>"
    );
  }
  function mountLoginForm() {
    var form = document.getElementById("login-form");
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var fd = new FormData(form);
      var errBox = document.getElementById("login-error");
      errBox.classList.add("hidden");
      try {
        var res = await api("/api/auth/login", { method: "POST", body: { email: fd.get("email"), password: fd.get("password") } });
        state.user = res.user;
        location.hash = "#/";
        await boot();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove("hidden");
      }
    });
  }

  // ---------------- Audits list ----------------
  async function mountAuditsList() {
    var mount = document.getElementById("audits-list-mount");
    try {
      var res = await api("/api/audits?limit=100");
      var rows = res.rows;
      mount.outerHTML =
        '<div class="card overflow-x-auto">' +
        '<table class="w-full text-sm">' +
        '<thead class="bg-gray-50 text-left text-xs text-gray-500 uppercase"><tr>' +
        '<th class="p-3">Date</th><th class="p-3">Counselor</th><th class="p-3">Applicant</th><th class="p-3">Duration</th>' +
        '<th class="p-3">Score</th><th class="p-3">Rating</th><th class="p-3">Coaching</th><th class="p-3"></th>' +
        "</tr></thead><tbody>" +
        (rows.length === 0 ? '<tr><td colspan="8" class="p-6 text-center text-gray-400">No audits yet.</td></tr>' : "") +
        rows.map(function (a) {
          var pct = a.max_possible_score ? Math.round((a.overall_score / a.max_possible_score) * 1000) / 10 : null;
          return (
            "<tr class=\"border-t\">" +
            '<td class="p-3">' + escapeHtml(a.audit_date) + "</td>" +
            '<td class="p-3">' + escapeHtml(a.counselor_name) + "</td>" +
            '<td class="p-3">' + escapeHtml(a.applicant_name) + (a.has_recording ? " 🎙" : "") + "</td>" +
            '<td class="p-3">' + Math.round(a.duration_seconds / 60) + " min</td>" +
            '<td class="p-3">' + (pct == null ? "—" : pct + "%") + "</td>" +
            '<td class="p-3">' + ratingBadge(a.final_result) + "</td>" +
            '<td class="p-3">' + escapeHtml(a.coaching_priority || "—") + "</td>" +
            '<td class="p-3"><a class="text-blue-700 hover:underline" href="#/audits/' + a.id + '">View</a></td>' +
            "</tr>"
          );
        }).join("") +
        "</tbody></table></div>" +
        '<p class="text-xs text-gray-400 mt-2">Showing ' + rows.length + " of " + res.total + " audits.</p>";
    } catch (err) {
      mount.outerHTML = '<div class="card p-6 text-red-600">' + escapeHtml(err.message) + "</div>";
    }
  }

  // ---------------- New audit form ----------------
  var VERY_SHORT_CALL_SECONDS = 60, SHORT_CALL_SECONDS = 150;

  async function mountNewAuditForm() {
    var mount = document.getElementById("new-audit-mount");
    try {
      if (!state.meta) state.meta = await api("/api/meta");
    } catch (err) {
      mount.outerHTML = '<div class="card p-6 text-red-600">' + escapeHtml(err.message) + "</div>";
      return;
    }
    var meta = state.meta;
    var byCategory = {};
    meta.scorecardParameters.forEach(function (p) {
      (byCategory[p.category_id] = byCategory[p.category_id] || []).push(p);
    });

    var html =
      '<form id="new-audit-form" class="space-y-6">' +
      '<div class="card p-5">' +
      '<h2 class="font-semibold mb-3">Call details</h2>' +
      '<div class="grid sm:grid-cols-2 gap-4">' +
      '<div><label class="field-label">Counselor</label><select name="counselorId" class="input" required><option value="">Select…</option>' +
      meta.counselors.filter(function (c) { return c.status === "ACTIVE"; }).map(function (c) { return '<option value="' + c.id + '">' + escapeHtml(c.name) + " (" + escapeHtml(c.employee_code) + ")</option>"; }).join("") +
      "</select></div>" +
      '<div><label class="field-label">Programme</label><select name="programmeId" class="input" required><option value="">Select…</option>' +
      meta.programmes.map(function (p) { return '<option value="' + p.id + '">' + escapeHtml(p.name) + "</option>"; }).join("") +
      "</select></div>" +
      '<div><label class="field-label">Call date</label><input type="date" name="callDate" class="input" required /></div>' +
      '<div><label class="field-label">Call type</label><select name="callType" class="input" required>' +
      ["INBOUND", "OUTBOUND", "FOLLOW_UP", "WALK_IN_TELE"].map(function (t) { return '<option value="' + t + '">' + t + "</option>"; }).join("") + "</select></div>" +
      '<div><label class="field-label">Applicant stage</label><select name="applicantStage" class="input" required>' +
      ["NEW_ENQUIRY", "COUNSELING", "APPLICATION", "ADMISSION", "ENROLLED"].map(function (t) { return '<option value="' + t + '">' + t + "</option>"; }).join("") + "</select></div>" +
      '<div><label class="field-label">Duration (seconds)</label><input type="number" min="1" name="durationSeconds" id="audit-duration-input" class="input" required /></div>' +
      '<div><label class="field-label">Applicant name</label><input name="applicantName" class="input" required /></div>' +
      '<div><label class="field-label">Applicant phone</label><input name="applicantPhone" class="input" /></div>' +
      '<div><label class="field-label">Disposition</label><input name="disposition" class="input" /></div>' +
      '<div class="flex items-center gap-2 mt-6"><input type="checkbox" name="recordingDisclosed" id="recording-disclosed" /><label for="recording-disclosed" class="text-sm">Recording disclosed to applicant</label></div>' +
      "</div>" +
      '<div id="duration-warning" class="hidden mt-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded p-3"></div>' +
      "</div>" +
      Object.keys(byCategory).map(function (catId) {
        var params = byCategory[catId];
        var catName = params[0].category_name;
        return (
          '<div class="card p-5">' +
          '<h2 class="font-semibold mb-3">' + escapeHtml(catName) + '<span class="text-xs text-gray-400 font-normal"> (' + params[0].category_max_points + " pts)</span></h2>" +
          '<div class="space-y-4">' +
          params.map(function (p) {
            return (
              '<div class="border-t pt-3">' +
              '<div class="flex items-center justify-between mb-1">' +
              '<div class="text-sm font-medium">' + escapeHtml(p.name) + '<span class="text-xs text-gray-400"> (weight ' + p.weight + ", " + p.error_severity + ")</span></div></div>" +
              (p.description ? '<div class="text-xs text-gray-500 mb-2">' + escapeHtml(p.description) + "</div>" : "") +
              '<div class="grid sm:grid-cols-3 gap-3">' +
              '<div><label class="field-label">Score %</label><input type="number" min="0" max="100" name="score_' + p.id + '" class="input" placeholder="0–100" required /></div>' +
              '<div class="sm:col-span-1"><label class="field-label">Evidence</label><input name="evidence_' + p.id + '" class="input" placeholder="What was observed on the call" /></div>' +
              '<div class="sm:col-span-1"><label class="field-label">Area of improvement</label><input name="aoi_' + p.id + '" class="input" placeholder="Optional" /></div>' +
              "</div></div>"
            );
          }).join("") +
          "</div></div>"
        );
      }).join("") +
      '<div class="card p-5">' +
      '<h2 class="font-semibold mb-3">Zero Tolerance Policy</h2>' +
      '<div class="flex items-center gap-2 mb-3"><input type="checkbox" name="ztpConfirmed" id="ztp-confirmed" /><label for="ztp-confirmed" class="text-sm">Confirm a ZTP violation occurred on this call</label></div>' +
      '<div><label class="field-label">ZTP rule</label><select name="ztpRuleId" class="input"><option value="">Select…</option>' +
      meta.ztpRules.map(function (r) { return '<option value="' + r.id + '">' + escapeHtml(r.code) + " — " + escapeHtml(r.category) + "</option>"; }).join("") +
      "</select></div>" +
      '<div class="mt-3"><label class="field-label">Root cause category (if applicable)</label><input name="rootCauseCategory" class="input" /></div>' +
      "</div>" +
      '<div class="card p-5">' +
      '<label class="field-label">QA comments</label><textarea name="qaComments" class="input" rows="3"></textarea>' +
      "</div>" +
      '<div id="form-error" class="text-sm text-red-600 hidden"></div>' +
      '<button type="submit" class="btn btn-primary">Submit audit</button>' +
      "</form>";

    mount.outerHTML = html;

    var durationInput = document.getElementById("audit-duration-input");
    var warnBox = document.getElementById("duration-warning");
    function checkDuration() {
      var secs = Number(durationInput.value || 0);
      if (secs > 0 && secs < VERY_SHORT_CALL_SECONDS) {
        warnBox.textContent = "This call is under 1 minute. A call this short rarely covers every scorecard parameter — make sure each score below genuinely reflects what happened on the call, not a default.";
        warnBox.classList.remove("hidden");
      } else if (secs > 0 && secs < SHORT_CALL_SECONDS) {
        warnBox.textContent = "This is a short call (under 2.5 minutes). Double-check that every parameter score is backed by something you actually heard.";
        warnBox.classList.remove("hidden");
      } else {
        warnBox.classList.add("hidden");
      }
    }
    durationInput.addEventListener("input", checkDuration);

    var form = document.getElementById("new-audit-form");
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var fd = new FormData(form);
      var errBox = document.getElementById("form-error");
      errBox.classList.add("hidden");
      var scores = meta.scorecardParameters.map(function (p) {
        return { parameterId: p.id, scorePercent: Number(fd.get("score_" + p.id)), evidence: fd.get("evidence_" + p.id) || "", aoi: fd.get("aoi_" + p.id) || "" };
      });
      var payload = {
        counselorId: Number(fd.get("counselorId")), programmeId: Number(fd.get("programmeId")), callDate: fd.get("callDate"),
        callType: fd.get("callType"), applicantStage: fd.get("applicantStage"), durationSeconds: Number(fd.get("durationSeconds")),
        applicantName: fd.get("applicantName"), applicantPhone: fd.get("applicantPhone") || null, disposition: fd.get("disposition") || null,
        recordingDisclosed: fd.get("recordingDisclosed") === "on", scores: scores,
        ztpConfirmed: fd.get("ztpConfirmed") === "on", ztpRuleId: fd.get("ztpRuleId") ? Number(fd.get("ztpRuleId")) : null,
        rootCauseCategory: fd.get("rootCauseCategory") || null, qaComments: fd.get("qaComments") || "",
      };
      try {
        var res = await api("/api/audits", { method: "POST", body: payload });
        toast("Audit submitted — result: " + ratingLabel(res.finalResultCode));
        location.hash = "#/audits/" + res.auditId;
        await boot();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove("hidden");
      }
    });
  }

  // ---------------- Audit detail ----------------
  async function mountAuditDetail(id) {
    var mount = document.getElementById("audit-detail-mount");
    try {
      var detail = await api("/api/audits/" + id);
      var a = detail.audit;
      var pct = a.max_possible_score ? Math.round((a.overall_score / a.max_possible_score) * 1000) / 10 : null;
      var byPid = {};
      (state.meta ? state.meta.scorecardParameters : []).forEach(function (p) { byPid[p.id] = p; });

      var html =
        '<div class="mb-4"><a href="#/audits" class="text-sm text-blue-700 hover:underline">&larr; Back to audits</a></div>' +
        '<div class="card p-5 mb-5">' +
        '<div class="flex items-start justify-between flex-wrap gap-3">' +
        "<div>" +
        '<h1 class="text-lg font-bold">' + escapeHtml(a.applicant_name) + " — " + escapeHtml(a.counselor_name) + "</h1>" +
        '<p class="text-sm text-gray-500">' + escapeHtml(a.call_date) + " · " + escapeHtml(a.call_type) + " · " + escapeHtml(a.applicant_stage) + " · " + Math.round(a.duration_seconds / 60) + " min" + (a.has_recording ? " · 🎙 has recording" : "") + "</p>" +
        "</div>" +
        '<div class="text-right">' + ratingBadge(a.final_result) + '<div class="text-2xl font-bold mt-1">' + (pct == null ? "—" : pct + "%") + "</div></div>" +
        "</div>" +
        (a.ztp_flag ? '<div class="mt-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded p-3">Zero Tolerance Policy violation confirmed on this call.</div>' : "") +
        (a.qa_comments ? '<div class="mt-3 text-sm text-gray-700"><span class="font-medium">QA comments:</span> ' + escapeHtml(a.qa_comments) + "</div>" : "") +
        "</div>" +
        '<div class="card p-5 mb-5">' +
        '<h2 class="font-semibold mb-3">Scores</h2>' +
        '<table class="w-full text-sm"><thead class="text-left text-xs text-gray-500 uppercase"><tr><th class="py-2">Parameter</th><th class="py-2">Score</th><th class="py-2">Weighted</th><th class="py-2">Evidence</th></tr></thead><tbody>' +
        detail.scores.map(function (s) {
          var p = byPid[s.parameter_id];
          return "<tr class=\"border-t\"><td class=\"py-2\">" + escapeHtml(p ? p.name : "Parameter #" + s.parameter_id) + '</td><td class="py-2">' + s.score_percent + "%</td><td class=\"py-2\">" + s.weighted_score + '</td><td class="py-2 text-gray-500">' + escapeHtml(s.evidence || "") + "</td></tr>";
        }).join("") +
        "</tbody></table></div>" +
        '<div class="card p-5">' +
        '<h2 class="font-semibold mb-3">History</h2>' +
        '<ul class="text-sm space-y-2">' +
        detail.history.map(function (h) {
          return '<li class="border-t pt-2"><span class="font-medium">' + escapeHtml(h.action) + "</span> — " + fmtDateTime(h.created_at) + (h.reason ? '<div class="text-gray-500">' + escapeHtml(h.reason) + "</div>" : "") + "</li>";
        }).join("") +
        "</ul></div>";

      mount.outerHTML = html;
    } catch (err) {
      mount.outerHTML = '<div class="card p-6 text-red-600">' + escapeHtml(err.message) + "</div>";
    }
  }

  // ---------------- Boot ----------------
  async function boot() {
    try {
      var res = await api("/api/auth/me");
      state.user = res.user;
    } catch (e) {
      state.user = null;
    }
    await router();
  }

  window.addEventListener("hashchange", router);
  document.addEventListener("DOMContentLoaded", boot);

  window.WilpQaApp = { api: api }; // exposed for testing
})();
