// 화면 파일(/assets/*)을 못 불러오거나 10초 넘게 화면이 비어 있으면,
    // 예전 서비스 워커·캐시를 지우고 한 번만 새로 불러온다 (설치한 앱이 지난 배포 파일을 찾다 멈추는 경우)
    (function () {
      var KEY = 'wr.recover', done = false;
      function recover() {
        if (done) return;
        done = true;
        try { if (Date.now() - (+localStorage.getItem(KEY) || 0) < 5 * 60e3) return; localStorage.setItem(KEY, Date.now()); } catch (e) { return; }
        var jobs = [];
        if (navigator.serviceWorker) jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) { return Promise.all(rs.map(function (r) { return r.unregister(); })); }));
        if (window.caches) jobs.push(caches.keys().then(function (ks) { return Promise.all(ks.map(function (k) { return caches.delete(k); })); }));
        Promise.all(jobs).catch(function () {}).then(function () { location.reload(); });
      }
      addEventListener('error', function (e) {
        var t = e.target, u = t && (t.src || t.href);
        if (u && /\/assets\//.test(u)) recover();
      }, true);
      setTimeout(function () {
        var root = document.getElementById('root');
        if (root && !root.firstChild) recover();
      }, 10000);
    })();
