
      import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
      import {
        getFirestore, collection, query, where,
        getDocs, doc, getDoc, setDoc, addDoc,
        onSnapshot, serverTimestamp, deleteField,
      } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

      const firebaseConfig = {
        apiKey: "AIzaSyB0lQ4kN9YBskuaNp-8AcOfTAfUYPbhSbU",
        authDomain: "classpulse-97289.firebaseapp.com",
        projectId: "classpulse-97289",
        storageBucket: "classpulse-97289.firebasestorage.app",
        messagingSenderId: "844668167541",
        appId: "1:844668167541:web:dfd90a7024876a30d05f3c",
      };

      const app = initializeApp(firebaseConfig);
      const db  = getFirestore(app);

      let sessionId   = null;
      let selectedSig = null;
      let unsubscribe = null;
      let saveTimeout = null;
      let currentContextRaw = "";
      let currentContextTopics = [];
      let currentContextSummary = "";
      let toggleHistory = [];
let buttonsLockedUntil = 0;
      let currentContextPurpose = "";
      let checkpointQuiz = [];
      let checkpointAnswers = {};
      let checkpointBusy = false;

      // ── Nudge state ───────────────────────────────────────────
      const NUDGE_DELAY    = 15;
      let nudgeInterval    = null;
      let nudgeSecondsLeft = NUDGE_DELAY;
      let nudgeArmedForRound = false;

      function monitorToggleSpam() {

  const now = Date.now();

  if (now < buttonsLockedUntil) {
    return false;
  }

  toggleHistory = toggleHistory.filter(t => now - t < 30000);
  toggleHistory.push(now);

  if (toggleHistory.length > 5) {
    buttonsLockedUntil = now + 30000;
    disableSignalButtons();

    setTimeout(() => {
      enableSignalButtons();
    }, 30000);

    return false;
  }

  return true;
}

function disableSignalButtons() {

  document.querySelectorAll(".signal-btn").forEach(btn => {
    btn.disabled = true;
    btn.style.opacity = "0.5";
  });
}

function enableSignalButtons() {

  document.querySelectorAll(".signal-btn").forEach(btn => {
    btn.disabled = false;
    btn.style.opacity = "1";
  });

  toggleHistory = [];
}

     function getDeviceId() {
  let deviceId = localStorage.getItem("deviceId");

  if (!deviceId) {
    deviceId = "dev_" + Math.random().toString(36).slice(2, 12);
    localStorage.setItem("deviceId", deviceId);
  }

  return deviceId;
}

const studentId = getDeviceId();

      // ── Auto-connect from URL ─────────────────────────────────
      window.addEventListener("load", async () => {
        const params = new URLSearchParams(window.location.search);
        const s = params.get("session");
        if (s && s.trim()) {
          document.getElementById("joinBtn").textContent = "Connecting…";
          document.getElementById("joinBtn").disabled    = true;
          document.getElementById("codeInput").disabled  = true;
          await connectToSession(s, true);
        }
      });

      // ── Manual join ───────────────────────────────────────────
      window.joinSession = async function () {
        const code    = document.getElementById("codeInput").value.trim();
        const joinBtn = document.getElementById("joinBtn");
        joinBtn.disabled    = true;
        joinBtn.textContent = "Joining…";
        await connectToSession(code, false);
        if (document.getElementById("joinError").style.display !== "none") {
          joinBtn.disabled    = false;
          joinBtn.textContent = "Join →";
        }
      };

      async function connectToSession(idOrCode, isDirectId) {
        const errEl = document.getElementById("joinError");
        errEl.style.display = "none";

        try {
          let sessionDoc = null;

          if (isDirectId) {
            const direct = await getDoc(doc(db, "sessions", idOrCode.trim()));
            if (direct.exists()) {
              sessionDoc = { id: direct.id, data: () => direct.data() };
            } else {
              const all   = await getDocs(collection(db, "sessions"));
              const match = all.docs.find(d => d.id === idOrCode.trim());
              if (match) sessionDoc = { id: match.id, data: () => match.data() };
            }
          } else {
            if (idOrCode.length !== 4 || isNaN(idOrCode)) {
              errEl.textContent   = "Please enter a valid 4-digit code.";
              errEl.style.display = "block";
              return;
            }
            const q    = query(collection(db, "sessions"), where("code", "==", idOrCode));
            const snap = await getDocs(q);
            if (!snap.empty) sessionDoc = { id: snap.docs[0].id, data: () => snap.docs[0].data() };
          }

          if (!sessionDoc) {
            errEl.textContent   = "Session not found. Check the code and try again.";
            errEl.style.display = "block";
            return;
          }

          sessionId  = sessionDoc.id;
          const studentRef = doc(db, "sessions", sessionId, "students", studentId);

const existingStudent = await getDoc(studentRef);

if (existingStudent.exists()) {
  errEl.textContent = "You have already joined this session.";
  errEl.style.display = "block";
  return;
}

// register student
await setDoc(studentRef, {
  joinedAt: serverTimestamp(),
  deviceId: studentId
});
          const data = sessionDoc.data();

          document.getElementById("sessionInfo").innerHTML = `
            <p class="label">SESSION</p>
            <p class="value">${data.sessionName}</p>
            <p class="label" style="margin-top:10px">TEACHER</p>
            <p class="value">${data.teacherName}</p>
          `;
          document.getElementById("sessionNameLabel").textContent = data.sessionName;
          document.getElementById("joinScreen").style.display = "none";
          document.getElementById("waiting").style.display    = "block";

          window.history.replaceState({}, "", `${window.location.pathname}?session=${encodeURIComponent(sessionId)}`);

          listenToSession(sessionId);

        } catch (e) {
          console.error(e);
          errEl.textContent   = "Connection error. Try again.";
          errEl.style.display = "block";
        }
      }

      // ── Session listener ──────────────────────────────────────
      let hasBeenActive = false;

      function listenToSession(sid) {
        if (unsubscribe) unsubscribe();
        unsubscribe = onSnapshot(doc(db, "sessions", sid), snap => {
          if (!snap.exists()) return;
          const data = snap.data();

          currentContextRaw = typeof data.contextRaw === "string" ? data.contextRaw : "";
          currentContextTopics = Array.isArray(data.contextTopics)
            ? data.contextTopics.filter((t) => typeof t === "string")
            : [];
          currentContextSummary = typeof data.contextSummary === "string" ? data.contextSummary : "";
          currentContextPurpose = typeof data.contextPurpose === "string" ? data.contextPurpose : "";

          renderStudentQuiz(data.activeQuiz);

          if (data.active) {
            hasBeenActive = true;
            document.getElementById("waiting").style.display   = "none";
            document.getElementById("submitted").style.display = "none";
            document.getElementById("active").style.display    = "block";

            // only start the nudge timer once per round
            if (!nudgeArmedForRound && !selectedSig) {
              nudgeArmedForRound = true;
              startNudgeTimer();
            }

          } else {
            // Round closed — stop nudge and reset the armed flag
            // so the next round will arm it fresh.
            stopNudgeTimer();
            hideNudge();
            nudgeArmedForRound = false;  // FIX: reset for next round

            selectedSig = null;
            checkpointQuiz = [];
            checkpointAnswers = {};
            checkpointBusy = false;
            resetSignalButtons();
            hideQuestionSection();
            hideCheckpointOverlay();
            showSaving('');
            document.getElementById("active").style.display = "none";

            if (hasBeenActive) {
              document.getElementById("submitted").style.display = "block";
              document.getElementById("waiting").style.display   = "none";
            } else {
              document.getElementById("waiting").style.display   = "block";
              document.getElementById("submitted").style.display = "none";
            }
          }
        });
      }

      // ── Nudge helpers ─────────────────────────────────────────
      function startNudgeTimer() {
        stopNudgeTimer();
        nudgeSecondsLeft = NUDGE_DELAY;
        updateNudgeBar(NUDGE_DELAY);

        nudgeInterval = setInterval(() => {
          nudgeSecondsLeft--;
          updateNudgeBar(nudgeSecondsLeft);
          if (nudgeSecondsLeft <= 0) {
            stopNudgeTimer();
            showNudge();
          }
        }, 1000);
      }

      function stopNudgeTimer() {
        clearInterval(nudgeInterval);
        nudgeInterval = null;
      }

      function updateNudgeBar(s) {
        const bar = document.getElementById("nudgeBar");
        bar.style.width = (s / NUDGE_DELAY * 100) + "%";
        bar.className   = "nudge-bar" + (s <= 3 ? " red" : s <= 6 ? " amber" : "");
        document.getElementById("nudgeCountdown").textContent = s > 0 ? s + "s" : "";
      }

      function showNudge() {
        updateNudgeBar(NUDGE_DELAY);
        document.getElementById("nudgeCountdown").textContent = "";
        document.getElementById("nudgeOverlay").classList.add("visible");
      }

      function hideNudge() {
        document.getElementById("nudgeOverlay").classList.remove("visible");
      }

      window.selectFromNudge = async function (signal) {
        hideNudge();
        stopNudgeTimer();
        await selectSignal(signal);
      };

      // ── Signal selection ──────────────────────────────────────
      window.selectSignal = async function (signal) {
        if (!monitorToggleSpam()) return;

        stopNudgeTimer();
        hideNudge();

        if (signal === 'sort_of') {
          await openCheckpointQuiz();
          return;
        }

        await setStudentSignal(signal);
      };

      function resetSignalButtons() {
        ["got_it", "sort_of", "lost"].forEach(id =>
          document.getElementById("btn_" + id).classList.remove("selected")
        );
      }

      function getApiBaseUrl() {
        return (window.location.protocol === "file:")
          ? "http://192.168.0.144:3000"
          : `${window.location.protocol}//${window.location.hostname}:3000`;
      }

      async function setStudentSignal(signal, extras = {}) {
        const hasQuizScore = Object.prototype.hasOwnProperty.call(extras, "quizScore");
        if (selectedSig === signal && !hasQuizScore) return;

        selectedSig = signal;
        resetSignalButtons();

        const activeButton = document.getElementById("btn_" + signal);
        if (activeButton) activeButton.classList.add("selected");

        if (signal === 'lost') showQuestionSection();
        else hideQuestionSection();

        checkpointQuiz = [];
        checkpointAnswers = {};
        hideCheckpointOverlay();

        showSaving('saving');
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(async () => {
          try {
            await setDoc(doc(db, "sessions", sessionId, "students", studentId), {
              signal,
              quizScore: hasQuizScore ? extras.quizScore : deleteField(),
              updatedAt: serverTimestamp(),
            }, { merge: true });
            showSaving('saved');
            setTimeout(() => showSaving(''), 2000);
          } catch (e) {
            console.error("Save signal failed:", e);
            showSaving('');
          }
        }, 400);
      }

      async function openCheckpointQuiz() {
        if (checkpointBusy) return;

        if (checkpointQuiz.length) {
          showCheckpointOverlay();
          renderCheckpointQuiz();
          return;
        }

        checkpointBusy = true;
        selectedSig = "sort_of";
        checkpointAnswers = {};
        resetSignalButtons();
        document.getElementById("btn_sort_of").classList.add("selected");
        hideQuestionSection();
        renderCheckpointLoading();
        showCheckpointOverlay();

        try {
          const response = await fetch(`${getApiBaseUrl()}/generate-quiz`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              responseFormat: "mcq",
              contextSummary: currentContextSummary || currentContextRaw,
              contextTopics: currentContextTopics,
            }),
          });

          if (!response.ok) {
            throw new Error(`quiz generation failed: ${response.status}`);
          }

          const payload = await response.json();
          const questions = Array.isArray(payload?.questions) ? payload.questions : [];
          const validQuestions = questions.filter((item) =>
            typeof item?.question === "string" &&
            Array.isArray(item?.options) &&
            item.options.length === 4 &&
            typeof item?.correctAnswer === "string"
          );

          if (validQuestions.length !== 5) {
            throw new Error("invalid quiz payload");
          }

          checkpointQuiz = validQuestions;
          renderCheckpointQuiz();
        } catch (error) {
          console.error("Checkpoint quiz failed:", error);
          checkpointQuiz = [];
          checkpointAnswers = {};
          renderCheckpointFailure();
        } finally {
          checkpointBusy = false;
        }
      }

      function showCheckpointOverlay() {
        document.getElementById("checkpointOverlay").classList.add("visible");
      }

      function hideCheckpointOverlay() {
        document.getElementById("checkpointOverlay").classList.remove("visible");
        clearCheckpointStatus();
      }

      function clearCheckpointStatus() {
        const status = document.getElementById("checkpointStatus");
        status.className = "checkpoint-status";
        status.textContent = "";
      }

      function renderCheckpointLoading() {
        clearCheckpointStatus();
        document.getElementById("checkpointBody").innerHTML = `
          <p class="checkpoint-loading">Preparing a quiz for this session...</p>
        `;
      }

      function renderCheckpointFailure() {
        clearCheckpointStatus();
        document.getElementById("checkpointBody").innerHTML = `
          <p class="checkpoint-loading">Couldn't create a quick quiz right now.</p>
          <button class="ask-btn" onclick="fallbackToNotClear()">Continue as not clear</button>
        `;
      }

      function renderCheckpointQuiz() {
        if (!checkpointQuiz.length) return;

        const answeredCount = Object.keys(checkpointAnswers).length;

        clearCheckpointStatus();
        document.getElementById("checkpointBody").innerHTML = `
          <p class="checkpoint-progress">${answeredCount}/5 answered</p>
          ${checkpointQuiz.map((item, questionIndex) => `
            <div class="checkpoint-question-block">
              <p class="checkpoint-question">Q${questionIndex + 1}. ${escapeHtml(item.question)}</p>
              <div class="checkpoint-options">
                ${item.options.map((option, optionIndex) => `
                  <label class="checkpoint-option ${checkpointAnswers[questionIndex] === optionIndex ? "selected" : ""}">
                    <input
                      type="radio"
                      name="checkpoint_q_${questionIndex}"
                      value="${optionIndex}"
                      ${checkpointAnswers[questionIndex] === optionIndex ? "checked" : ""}
                      onchange="setCheckpointAnswer(${questionIndex}, ${optionIndex})"
                    />
                    <span>${escapeHtml(option)}</span>
                  </label>
                `).join("")}
              </div>
            </div>
          `).join("")}
          <div class="checkpoint-actions">
            <button
              class="checkpoint-submit"
              onclick="submitCheckpointQuiz()"
              ${answeredCount === checkpointQuiz.length ? "" : "disabled"}
            >Submit quiz</button>
          </div>
        `;
      }

      function escapeHtml(text) {
        return String(text)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      window.setCheckpointAnswer = function (questionIndex, optionIndex) {
        checkpointAnswers[questionIndex] = optionIndex;
        renderCheckpointQuiz();
      };

      window.submitCheckpointQuiz = async function () {
        if (!checkpointQuiz.length) return;

        if (Object.keys(checkpointAnswers).length !== checkpointQuiz.length) {
          return;
        }

        const correctAnswers = checkpointQuiz.reduce((count, item, questionIndex) => {
          const selectedIndex = checkpointAnswers[questionIndex];
          const selectedOption = typeof selectedIndex === "number" ? item.options[selectedIndex] : null;
          return count + (selectedOption === item.correctAnswer ? 1 : 0);
        }, 0);

        const score = correctAnswers / checkpointQuiz.length;
        const finalSignal = score >= 0.5 ? "got_it" : "lost";
        const status = document.getElementById("checkpointStatus");
        status.className = `checkpoint-status visible ${finalSignal === "got_it" ? "good" : "bad"}`;
        status.textContent = `Score: ${correctAnswers}/5 (${Math.round(score * 100)}%). Marking this as ${finalSignal === "got_it" ? "Got It" : "Lost"}.`;

        document.querySelectorAll(".checkpoint-option").forEach((optionEl) => {
          optionEl.classList.add("locked");
          const input = optionEl.querySelector("input");
          if (input) input.disabled = true;
        });

        setTimeout(async () => {
          await setStudentSignal(finalSignal, { quizScore: score });
        }, 900);
      };

      window.fallbackToNotClear = async function () {
        await setStudentSignal("lost");
      };

      function showQuestionSection() {
        document.getElementById("qSection").classList.add("visible");
        document.getElementById("questionInput").value = "";
        document.getElementById("questionInput").classList.remove("error-border");
        document.getElementById("qSent").style.display  = "none";
        document.getElementById("qError").style.display = "none";
        document.getElementById("askBtn").disabled      = false;
        document.getElementById("askBtn").textContent   = "Send question →";
      }

      function hideQuestionSection() {
        document.getElementById("qSection").classList.remove("visible");
      }

            function renderStudentQuiz(activeQuiz) {
              const quizSection = document.getElementById("quizSection");
              const quizQuestions = document.getElementById("quizQuestions");

              const questions = Array.isArray(activeQuiz?.questions)
                ? activeQuiz.questions
                : [];

              if (!questions.length) {
                quizSection.classList.remove("visible");
                quizQuestions.innerHTML = "";
                return;
              }

              quizQuestions.innerHTML = questions
                .map((q, idx) => {
                  const text = typeof q === "string" ? q : q?.text;
                  if (!text) return "";
                  return `<div class="quiz-item"><strong>Q${idx + 1}:</strong> ${text}</div>`;
                })
                .join("");

              quizSection.classList.add("visible");
            }

      function showSaving(state) {
        const row  = document.getElementById("savingRow");
        const text = document.getElementById("savingText");
        row.className = "saving-row";
        if (state === 'saving') {
          row.classList.add("show");
          text.textContent = "Saving…";
        } else if (state === 'saved') {
          row.classList.add("saved");
          text.textContent = "✓ Response saved";
        } else {
          text.textContent = "";
        }
      }

      // ── Submit question ───────────────────────────────────────
      window.submitQuestion = async function () {
        const input  = document.getElementById("questionInput");
        const askBtn = document.getElementById("askBtn");
        const qError = document.getElementById("qError");
        const text   = input.value.trim();

        qError.style.display = "none";

        if (!text) {
          input.classList.add("error-border");
          input.focus();
          return;
        }

        if (!sessionId) {
          qError.textContent   = "Error: Not connected to a session. Please rejoin.";
          qError.style.display = "block";
          return;
        }

        input.classList.remove("error-border");
        askBtn.disabled    = true;
        askBtn.textContent = "Sending…";

        try {
          const validateRes = await fetch(`${getApiBaseUrl()}/validate-question`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              question: text,
              contextRaw: currentContextRaw,
              contextTopics: currentContextTopics,
              contextSummary: currentContextSummary || currentContextRaw,
            }),
          });

          if (!validateRes.ok) {
            qError.textContent = "Could not validate question right now. Please try again.";
            qError.style.display = "block";
            askBtn.disabled = false;
            askBtn.textContent = "Send question →";
            return;
          }

          const validation = await validateRes.json();
          if (validation?.isRelevant !== true) {
            qError.textContent = "Question not related to current class context, so it was not sent.";
            qError.style.display = "block";
            askBtn.disabled = false;
            askBtn.textContent = "Send question →";
            return;
          }

          // Prefer server-side dedup endpoint; fallback to direct Firestore write
          // so submission flow still works when server Firestore creds are not configured.
          let dedupResult = null;
          let usedFallback = false;

          try {
            const dedupRes = await fetch(`${getApiBaseUrl()}/submit-question-with-dedup`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId: sessionId,
                questionText: text,
                studentId: studentId,
                similarityThreshold: 0.75,
              }),
            });
            if (!dedupRes.ok) {
              throw new Error(`Dedup endpoint error: ${dedupRes.status}`);
            }
            dedupResult = await dedupRes.json();
            if (!dedupResult?.success) {
              throw new Error(dedupResult?.message || "Dedup endpoint returned unsuccessful response");
            }
          } catch (dedupError) {
            console.warn("[submitQuestion] Dedup unavailable, falling back to direct Firestore add:", dedupError);
            usedFallback = true;
            await addDoc(collection(db, "sessions", sessionId, "questions"), {
              text,
              count: 1,
              upvotes: 0,
              askedAt: serverTimestamp(),
              lastAskedAt: serverTimestamp(),
              studentId,
              studentIds: [studentId],
            });
            dedupResult = {
              isDuplicate: false,
              count: 1,
            };
          }

          // Show success message (indicate if it was merged or new)
          const successMsg = dedupResult.isDuplicate
            ? `✓ Question merged! (${dedupResult.count} similar questions)`
            : "✓ Question sent to teacher!";

          document.getElementById("qSent").style.display = "block";
          document.getElementById("qSent").textContent = successMsg;
          askBtn.textContent = "✓ Sent!";
          input.value = "";

          setTimeout(() => {
            askBtn.disabled = false;
            askBtn.textContent = "Send question →";
          }, 3000);
        } catch (e) {
          const msg = e?.message || e?.code || JSON.stringify(e) || "Unknown error";
          qError.textContent = "Failed to send: " + msg;
          qError.style.display = "block";
          askBtn.disabled = false;
          askBtn.textContent = "Send question →";
        }
      };

      // Enter key to join
      document.getElementById("codeInput").addEventListener("keydown", e => {
        if (e.key === "Enter") window.joinSession();
      });
    
