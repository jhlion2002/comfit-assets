(function () {
  var root = document.getElementById("comfit_player");
  var listEl = document.getElementById("cpList");
  if (!root || !listEl) return; // 이 포스트에 플레이어가 없으면 그냥 종료

  // ⚠️ 여기에 본인 YouTube Data API v3 키를 넣으세요.
  // Google Cloud Console에서 발급, HTTP 리퍼러를 https://comfit.tistory.com/* 로 제한할 것.
  var YT_API_KEY = "AIzaSyBJ5pMl8ezkWM6m9tnFAozU-KOMm8KmDlY";

  // 트랙 데이터는 #cpSource(본문)에서 읽음. data-id=videoId, data-duration=mm:ss(폴백용)
  var sourceEl = document.getElementById("cpSource");
  var TRACKS = sourceEl
    ? Array.prototype.map.call(sourceEl.querySelectorAll("li"), function (li) {
        var spans = li.querySelectorAll("span");
        return {
          id: li.getAttribute("data-id") || "",
          duration: li.getAttribute("data-duration") || "00:00", // API 실패 시 폴백
          title: spans[0] ? spans[0].textContent.trim() : "",
          artist: spans[1] ? spans[1].textContent.trim() : ""
        };
      })
    : [];

  if (TRACKS.length === 0) return; // 트랙 데이터가 비어있으면 실행 중단 (안전장치)

  // ---- 요소 참조 -------------------------------------------------------
  // 주의: 티스토리 에디터는 재수정 시 본문에 넣은 id 속성을 종종 지워버림.
  // 그래서 자주 사라지는 것들(시간/개수/합계 표시)은 id가 아니라
  // class + 구조(위치)로 찾는다. class는 사라지지 않으므로 안전함.
  var nowTitle = document.getElementById("cpNowTitle");
  var nowArtist = document.getElementById("cpNowArtist");
  var timeCur = root.querySelector(".cp-time:not(.end)");
  var timeDur = root.querySelector(".cp-time.end");
  var progressEl = document.getElementById("cpProgress");
  var progressFill = document.getElementById("cpProgressFill");
  var progressDot = document.getElementById("cpProgressDot");
  var toggleBtn = document.getElementById("cpToggle");
  var prevBtn = document.getElementById("cpPrev");
  var nextBtn = document.getElementById("cpNext");
  var shuffleBtn = document.getElementById("cpShuffle");
  var repeatBtn = document.getElementById("cpRepeat");
  var likeBtn = document.getElementById("cpLike");
  var menuBtn = document.getElementById("cpMenu");

  var headerCountSpans = root.querySelectorAll(".cp-list-header span span");
  var countA = headerCountSpans[0] || null; // TRACK LIST (n)
  var countB = headerCountSpans[1] || null; // 총 n곡
  var footerSummary = root.querySelector(".cp-footer span:first-child");

  var current = 0;
  var player = null;
  var pollTimer = null;
  var isShuffle = false;
  var isRepeatOne = false;
  var isSeeking = false;

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return (m < 10 ? "0" + m : m) + ":" + (s < 10 ? "0" + s : s);
  }
  function parseSec(mmss) {
    var parts = String(mmss).split(":");
    return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
  }

  // ---- ISO 8601 duration(PT1M1S) → 초 ----
  function parseISODuration(iso) {
    var m = String(iso || "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 0;
    var h = parseInt(m[1] || 0, 10);
    var mi = parseInt(m[2] || 0, 10);
    var s = parseInt(m[3] || 0, 10);
    return h * 3600 + mi * 60 + s;
  }

  // ---- YouTube Data API로 실제 길이 채워오기 (최대 50개 id를 한 번에 요청) ----
  function fetchDurations(tracks, done) {
    var ids = tracks.map(function (t) { return t.id; }).filter(Boolean).join(",");
    if (!ids || !YT_API_KEY || YT_API_KEY.indexOf("YOUR_") === 0) {
      done(); // 키 미설정 시 조용히 폴백(data-duration) 사용
      return;
    }
    var url = "https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id="
      + encodeURIComponent(ids) + "&key=" + encodeURIComponent(YT_API_KEY);

    fetch(url)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        var durMap = {};
        (data.items || []).forEach(function (item) {
          durMap[item.id] = parseISODuration(item.contentDetails && item.contentDetails.duration);
        });
        tracks.forEach(function (t) {
          if (durMap[t.id] != null && durMap[t.id] > 0) {
            t.duration = fmtTime(durMap[t.id]);
          }
        });
      })
      .catch(function () {
        // 네트워크/할당량 문제 시 조용히 폴백(data-duration) 사용
      })
      .finally(function () { done(); });
  }

  // ---- 트랙리스트 렌더 + 플레이어 초기화 (길이 확보 후 실행) ----
  function init() {
    listEl.innerHTML = ""; // 에디터가 남겨둔 자리표시(placeholder) 제거 후 새로 그림
    TRACKS.forEach(function (t, i) {
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cp-track" + (i === 0 ? " is-active" : "");
      btn.innerHTML =
        '<span class="cp-track-num">' + String(i + 1).padStart(2, "0") + '</span>' +
        '<span class="cp-track-text">' +
          '<div class="cp-track-title">' + t.title + '</div>' +
          '<div class="cp-track-artist">' + t.artist + '</div>' +
        '</span>' +
        '<span class="cp-track-dur">' + t.duration + '</span>';
      btn.addEventListener("click", function () { playTrack(i); if (player) player.playVideo(); });
      li.appendChild(btn);
      listEl.appendChild(li);
    });

    var totalSec = TRACKS.reduce(function (sum, t) { return sum + parseSec(t.duration); }, 0);
    if (countA) countA.textContent = TRACKS.length;
    if (countB) countB.textContent = TRACKS.length;
    if (footerSummary) {
      footerSummary.textContent = TRACKS.length + " Tracks / " + fmtTime(totalSec).replace(/^0/, "");
    }

    // YouTube IFrame API 로드
    var tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);

    window.onYouTubeIframeAPIReady = function () {
      player = new YT.Player("cp-yt-mount", {
        height: "1", width: "1",
        videoId: TRACKS[0].id,
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, modestbranding: 1 },
        events: {
          onReady: function () { updateNowDisplay(0); },
          onStateChange: function (e) {
            root.classList.toggle("is-playing", e.data === 1);
            if (e.data === 1) startPolling();
            if (e.data === 0) {
              if (isRepeatOne) {
                player.seekTo(0, true);
                player.playVideo();
              } else {
                goNext();
              }
            }
          }
        }
      });
    };
  }

  function updateNowDisplay(i) {
    var t = TRACKS[i];
    if (nowTitle) nowTitle.textContent = t.title;
    if (nowArtist) nowArtist.textContent = t.artist;
    if (timeDur) timeDur.textContent = t.duration;
    if (timeCur) timeCur.textContent = "00:00";
    if (progressFill) progressFill.style.width = "0%";
    if (progressDot) progressDot.style.left = "0%";
    document.querySelectorAll(".cp-track").forEach(function (el, idx) {
      el.classList.toggle("is-active", idx === i);
    });
  }

  function playTrack(i) {
    current = i;
    updateNowDisplay(i);
    if (!player) return;
    player.loadVideoById(TRACKS[i].id);
  }

  function goPrev() {
    var i = isShuffle ? randomIndexExcept(current) : (current - 1 + TRACKS.length) % TRACKS.length;
    playTrack(i);
    if (player) player.playVideo();
  }
  function goNext() {
    var i = isShuffle ? randomIndexExcept(current) : (current + 1) % TRACKS.length;
    playTrack(i);
    if (player) player.playVideo();
  }
  function randomIndexExcept(exclude) {
    if (TRACKS.length <= 1) return 0;
    var i;
    do { i = Math.floor(Math.random() * TRACKS.length); } while (i === exclude);
    return i;
  }

  prevBtn && prevBtn.addEventListener("click", goPrev);
  nextBtn && nextBtn.addEventListener("click", goNext);

  shuffleBtn && shuffleBtn.addEventListener("click", function () {
    isShuffle = !isShuffle;
    shuffleBtn.classList.toggle("is-active", isShuffle);
  });
  repeatBtn && repeatBtn.addEventListener("click", function () {
    isRepeatOne = !isRepeatOne;
    repeatBtn.classList.toggle("is-active", isRepeatOne);
  });
  likeBtn && likeBtn.addEventListener("click", function () {
    likeBtn.classList.toggle("is-liked");
    likeBtn.textContent = likeBtn.classList.contains("is-liked") ? "♥" : "♡";
  });
  menuBtn && menuBtn.addEventListener("click", function () {
    root.classList.toggle("list-collapsed");
  });

  toggleBtn && toggleBtn.addEventListener("click", function () {
    if (!player) return;
    var state = player.getPlayerState();
    if (state === 1) { player.pauseVideo(); } else { player.playVideo(); }
  });

  // ---- 진행률 바: 표시 + 드래그 탐색 ----
  function setProgressByRatio(ratio) {
    ratio = Math.min(1, Math.max(0, ratio));
    if (progressFill) progressFill.style.width = (ratio * 100) + "%";
    if (progressDot) progressDot.style.left = (ratio * 100) + "%";
  }
  function ratioFromEvent(e) {
    var rect = progressEl.getBoundingClientRect();
    var x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    return x / rect.width;
  }
  if (progressEl) {
    progressEl.addEventListener("pointerdown", function (e) {
      isSeeking = true;
      setProgressByRatio(ratioFromEvent(e));
    });
    window.addEventListener("pointermove", function (e) {
      if (!isSeeking) return;
      setProgressByRatio(ratioFromEvent(e));
    });
    window.addEventListener("pointerup", function (e) {
      if (!isSeeking) return;
      isSeeking = false;
      if (player && typeof player.getDuration === "function") {
        var ratio = ratioFromEvent(e);
        player.seekTo(Math.min(1, Math.max(0, ratio)) * player.getDuration(), true);
      }
    });
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(function () {
      if (!player || isSeeking || typeof player.getDuration !== "function") return;
      var dur = player.getDuration();
      var cur = player.getCurrentTime();
      if (dur > 0) {
        setProgressByRatio(cur / dur);
        if (timeCur) timeCur.textContent = fmtTime(cur);
      }
    }, 400);
  }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); }

  // 길이 확보(또는 폴백) 후 렌더 + 플레이어 초기화
  fetchDurations(TRACKS, init);
})();
