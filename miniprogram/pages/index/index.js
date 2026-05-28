const { request, login, uploadCapture } = require('../../utils/api');

const INITIAL_COUNT = 5;
const MORE_COUNT = 3;
const TOTAL_COUNT = 11;
const TRYON_POLL_INTERVAL = 2000;
const TRYON_POLL_LIMIT = 120;
const HAND_DETECT_INTERVAL = 180;
const SNAP_COOLDOWN = 950;
const PINCH_CLOSE_RATIO = 0.46;
const PINCH_OPEN_RATIO = 0.7;
const PINCH_SPEED_RATIO = 0.08;
const VK_VERSIONS = ['v2', 'v1'];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getPoint(points, index) {
  if (!points || !points[index]) return null;
  const point = points[index];
  if (Array.isArray(point)) return { x: Number(point[0]), y: Number(point[1]) };
  if (typeof point.x === 'number' && typeof point.y === 'number') return point;
  if (point.position) return getPoint([point.position], 0);
  if (point.origin) return getPoint([point.origin], 0);
  if (point.coordinate) return getPoint([point.coordinate], 0);
  if (typeof point[0] === 'number' && typeof point[1] === 'number') {
    return { x: Number(point[0]), y: Number(point[1]) };
  }
  return null;
}

function distance(a, b) {
  if (!a || !b) return 0;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function getAnchorPoints(anchor) {
  if (!anchor) return null;
  return anchor.points || anchor.keypoints || anchor.landmarks || anchor.skeleton || anchor.joints || anchor.handPoints || null;
}

Page({
  data: {
    quota: { used: 0, remaining: TOTAL_COUNT, limit: TOTAL_COUNT },
    image: '',
    recommendations: [],
    styles: [],
    currentIndex: 0,
    currentStyle: {},
    currentImage: '',
    analysis: {},
    tryonError: '',
    loading: false,
    loadingText: '',
    remainingCount: TOTAL_COUNT,
    snapFlash: false,
    gestureHint: '',
    gestureFallbackTapEnabled: false,
    loginStatus: '微信身份确认中'
  },

  onLoad() {
    this.ensureLogin();
  },

  async ensureLogin() {
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = login()
      .then((data) => {
        this.setData({
          ...(data.quota ? { quota: data.quota } : {}),
          loginStatus: '微信身份已确认'
        });
        return data;
      })
      .catch((err) => {
        this.loginPromise = null;
        this.setData({ loginStatus: '微信身份确认失败' });
        wx.showToast({ title: err.message || '登录失败，请稍后重试', icon: 'none' });
        throw err;
      });
    return this.loginPromise;
  },

  onShow() {
    if (this.cameraReady) this.initHandGesture();
  },

  onHide() {
    this.stopHandGesture();
  },

  onUnload() {
    this.stopHandGesture();
  },

  onCameraReady() {
    this.cameraReady = true;
    this.initHandGesture();
  },

  onCameraError(event) {
    wx.showToast({ title: event.detail && event.detail.errMsg ? event.detail.errMsg : '摄像头不可用', icon: 'none' });
  },

  initHandGesture() {
    if (this.handGestureStarted) return;
    if (!wx.createVKSession || !wx.createCameraContext) {
      this.setData({ gestureHint: '当前微信版本不支持手势识别，可使用按钮操作。' });
      return;
    }

    let session;
    let camera;
    let listener;
    const versions = this.getSupportedVKVersions();
    if (!versions.length) {
      const isDevtools = this.isDevtoolsRuntime();
      this.setData({
        gestureHint: isDevtools
          ? '开发者工具不支持手势识别，真机预览可测；点标题可模拟响指。'
          : '当前设备不支持手势识别，可使用按钮操作。',
        gestureFallbackTapEnabled: isDevtools
      });
      return;
    }

    for (let index = 0; index < versions.length; index += 1) {
      try {
        session = wx.createVKSession({
          version: versions[index],
          track: {
            hand: { mode: 2 }
          }
        });
        camera = wx.createCameraContext();
        listener = camera.onCameraFrame((frame) => this.onHandCameraFrame(frame));
        break;
      } catch (err) {
        session = null;
        listener = null;
      }
    }

    if (!session || !listener) {
      this.setData({ gestureHint: '手势识别初始化失败，可使用按钮操作。' });
      return;
    }

    if (!listener || typeof listener.start !== 'function') {
      this.setData({ gestureHint: '当前环境无法读取摄像头帧，可使用按钮操作。' });
      return;
    }

    this.handSession = session;
    this.handFrameListener = listener;
    this.handGestureStarted = true;
    this.handSessionReady = false;
    this.handSessionStarted = false;
    this.handleVKUpdateAnchors = (res) => this.handleHandAnchors(res);
    this.handleVKRemoveAnchors = () => this.resetSnapState();
    this.resetSnapState();

    if (session && typeof session.on === 'function') {
      session.on('updateAnchors', this.handleVKUpdateAnchors);
      session.on('removeAnchors', this.handleVKRemoveAnchors);
    }

    const startFrameListener = () => {
      if (!this.handGestureStarted || this.handSessionReady) return;
      this.handSessionReady = true;
      try {
        listener.start();
        this.setData({
          gestureHint: '捏一下或打响指即可开始推荐 / 切换发型。',
          gestureFallbackTapEnabled: false
        });
      } catch (err) {
        this.stopHandGesture();
        this.setData({ gestureHint: '手势识别启动失败，可使用按钮操作。' });
      }
    };

    try {
      if (session && typeof session.start === 'function') {
        this.handSessionReadyTimer = setTimeout(startFrameListener, 500);
        session.start((errno) => {
          if (this.handSessionReadyTimer) {
            clearTimeout(this.handSessionReadyTimer);
            this.handSessionReadyTimer = 0;
          }
          if (errno) {
            this.stopHandGesture({ skipSessionStop: true });
            this.setData({ gestureHint: '手势识别启动失败，可使用按钮操作。' });
            return;
          }
          this.handSessionStarted = true;
          startFrameListener();
        });
      } else {
        startFrameListener();
      }
    } catch (err) {
      this.stopHandGesture();
      this.setData({ gestureHint: '手势识别启动失败，可使用按钮操作。' });
    }
  },

  getSupportedVKVersions() {
    if (this.isDevtoolsRuntime()) return [];
    if (typeof wx.isVKSupport !== 'function') return ['v1'];
    const versions = [];
    for (let index = 0; index < VK_VERSIONS.length; index += 1) {
      const version = VK_VERSIONS[index];
      try {
        if (wx.isVKSupport(version)) versions.push(version);
      } catch (err) {}
    }
    return versions;
  },

  isDevtoolsRuntime() {
    try {
      const deviceInfo = typeof wx.getDeviceInfo === 'function' ? wx.getDeviceInfo() : wx.getSystemInfoSync();
      return !!deviceInfo && deviceInfo.platform === 'devtools';
    } catch (err) {
      return false;
    }
  },

  onGestureFallbackTap() {
    if (!this.data.gestureFallbackTapEnabled) return;
    this.triggerSnapAction();
  },

  stopHandGesture(options = {}) {
    if (this.handFrameListener && typeof this.handFrameListener.stop === 'function') {
      try {
        this.handFrameListener.stop();
      } catch (err) {}
    }
    if (this.handSession && typeof this.handSession.off === 'function') {
      try {
        if (this.handleVKUpdateAnchors) this.handSession.off('updateAnchors', this.handleVKUpdateAnchors);
        if (this.handleVKRemoveAnchors) this.handSession.off('removeAnchors', this.handleVKRemoveAnchors);
      } catch (err) {}
    }
    if (!options.skipSessionStop && this.handSessionStarted && this.handSession && typeof this.handSession.stop === 'function') {
      try {
        this.handSession.stop();
      } catch (err) {}
    }
    if (this.handSessionReadyTimer) {
      clearTimeout(this.handSessionReadyTimer);
      this.handSessionReadyTimer = 0;
    }
    this.handFrameListener = null;
    this.handSession = null;
    this.handGestureStarted = false;
    this.handSessionReady = false;
    this.handSessionStarted = false;
    this.handDetecting = false;
    this.handleVKUpdateAnchors = null;
    this.handleVKRemoveAnchors = null;
    this.resetSnapState();
  },

  onHandCameraFrame(frame) {
    const now = Date.now();
    if (!this.handSessionReady || !this.handSession || this.handDetecting || now - (this.lastHandFrameAt || 0) < HAND_DETECT_INTERVAL) return;
    this.lastHandFrameAt = now;
    this.handDetecting = true;

    const finish = () => {
      this.handDetecting = false;
    };

    try {
      const result = this.handSession.detectHand({
        frameBuffer: frame.data,
        width: frame.width,
        height: frame.height,
        scoreThreshold: 0.55,
        sourceType: 0,
        algoMode: 2
      });
      if (result && typeof result.then === 'function') {
        result
          .then((payload) => {
            if (payload) this.handleHandAnchors(payload);
            finish();
          })
          .catch(() => {
            this.resetSnapState();
            finish();
          });
      } else {
        if (result) this.handleHandAnchors(result);
        setTimeout(finish, 120);
      }
    } catch (err) {
      finish();
    }
  },

  handleHandAnchors(payload) {
    this.handDetecting = false;
    const anchors = Array.isArray(payload)
      ? payload
      : (payload && (payload.anchors || payload.handAnchors || payload.results || payload.hand || payload.hands)) || [];
    const anchor = Array.isArray(anchors) ? anchors[0] : anchors;
    const points = getAnchorPoints(anchor);
    if (!points || points.length < 9) {
      this.resetSnapState();
      return;
    }

    const thumbTip = getPoint(points, 4);
    const indexTip = getPoint(points, 8);
    const middleTip = getPoint(points, 12);
    const wrist = getPoint(points, 0);
    const indexBase = getPoint(points, 5);
    const middleBase = getPoint(points, 9);
    const pinkyBase = getPoint(points, 17);

    const pinchDistance = Math.min(
      distance(thumbTip, indexTip) || Number.POSITIVE_INFINITY,
      distance(thumbTip, middleTip) || Number.POSITIVE_INFINITY
    );
    const palmScale = Math.max(
      distance(wrist, middleBase),
      distance(indexBase, pinkyBase),
      distance(indexBase, middleBase) * 2.2,
      0.001
    );
    const ratio = pinchDistance / palmScale;
    const lastRatio = typeof this.lastPinchRatio === 'number' ? this.lastPinchRatio : ratio;
    const closingSpeed = lastRatio - ratio;
    this.lastPinchRatio = ratio;

    if (ratio > PINCH_OPEN_RATIO) {
      this.snapPrimed = true;
      this.lastPinchClosed = false;
      return;
    }

    const now = Date.now();
    const isClosingAction = ratio < PINCH_CLOSE_RATIO && (this.snapPrimed || closingSpeed > PINCH_SPEED_RATIO);
    if (!this.lastPinchClosed && isClosingAction && now - (this.lastSnapAt || 0) > SNAP_COOLDOWN) {
      this.lastSnapAt = now;
      this.lastPinchClosed = true;
      this.snapPrimed = false;
      this.triggerSnapAction();
      return;
    }

    if (ratio > PINCH_CLOSE_RATIO + 0.12) {
      this.lastPinchClosed = false;
    }
  },

  resetSnapState() {
    this.snapPrimed = false;
    this.lastPinchClosed = false;
    this.lastPinchRatio = null;
  },

  triggerSnapAction() {
    if (!this.data.styles.length) {
      if (this.data.loading) return;
      this.playSnapEffect();
      this.startRecommend();
      return;
    }

    const generatedIndexes = this.data.styles
      .map((style, index) => (style.tryonImage ? index : -1))
      .filter((index) => index >= 0);

    if (!generatedIndexes.length) return;

    this.playSnapEffect();
    if (generatedIndexes.length < 2) {
      wx.showToast({ title: '第二款生成后可响指切换', icon: 'none' });
      return;
    }

    const currentGeneratedIndex = generatedIndexes.indexOf(this.data.currentIndex);
    const nextIndex = generatedIndexes[(currentGeneratedIndex + 1) % generatedIndexes.length] || generatedIndexes[0];
    const style = this.data.styles[nextIndex] || {};
    this.setData({
      currentIndex: nextIndex,
      currentStyle: style,
      currentImage: style.tryonImage || '',
      tryonError: ''
    });
  },

  playSnapEffect() {
    if (this.snapFlashTimer) clearTimeout(this.snapFlashTimer);
    this.setData({ snapFlash: true });
    this.snapFlashTimer = setTimeout(() => {
      this.setData({ snapFlash: false });
      this.snapFlashTimer = 0;
    }, 260);
  },

  async captureFrame() {
    const camera = wx.createCameraContext();
    return new Promise((resolve, reject) => {
      camera.takePhoto({
        quality: 'high',
        success: async (res) => {
          try {
            const uploaded = await uploadCapture(res.tempImagePath);
            resolve(uploaded.imageUrl);
          } catch (err) {
            reject(err);
          }
        },
        fail: reject
      });
    });
  },

  async startRecommend() {
    if (this.data.loading) return;
    try {
      await this.ensureLogin();
      this.setData({ loading: true, loadingText: '正在分析并生成 5 款发型' });
      const image = await this.captureFrame();
      const rec = await request('/api/hair-recommendation', {
        method: 'POST',
        data: { image, metrics: {}, count: TOTAL_COUNT }
      });
      const recommendations = (rec.recommendations || []).slice(0, TOTAL_COUNT);
      const first = recommendations.slice(0, INITIAL_COUNT).map((item, index) => ({ ...item, rank: index + 1 }));
      this.setData({
        image,
        recommendations,
        styles: first,
        analysis: rec.analysis || {},
        remainingCount: TOTAL_COUNT - first.length
      });
      if (rec.provider && /fallback/i.test(rec.provider)) {
        wx.showToast({ title: rec.warning || 'AI 分析失败，已使用备用推荐', icon: 'none' });
      }
      await this.generateTryOns(first);
    } catch (err) {
      wx.showToast({ title: err.message || '推荐失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async generateTryOns(styles) {
    await this.ensureLogin();
    const pendingStyles = (styles || []).filter((style) => style && !style.tryonImage);
    const errors = [];

    for (let index = 0; index < pendingStyles.length; index += 1) {
      const style = pendingStyles[index];
      this.setData({
        loading: true,
        loadingText: `正在生成第 ${index + 1}/${pendingStyles.length} 款试戴图：${style.label}`
      });

      try {
        const job = await request('/api/hair-tryon-job', {
          method: 'POST',
          data: {
            image: this.data.image,
            recommendations: [style],
            limit: 1
          }
        });
        if (job.quota) this.setData({ quota: job.quota });
        const payload = await this.waitForTryOnJob(job.jobId, style.label, index + 1, pendingStyles.length);
        const generated = (payload.variants || [])[0] || {};
        if (generated.error) errors.push(generated.error);

        const nextStyles = this.data.styles.map((item) => {
          if (item.id !== style.id) return item;
          if (generated.image) return { ...item, tryonImage: generated.image, tryonError: '' };
          if (generated.error) return { ...item, tryonError: generated.error };
          return { ...item, tryonError: '试戴图生成失败，请查看云托管运行日志。' };
        });
        const firstImageIndex = nextStyles.findIndex((item) => item.tryonImage);
        const generatedIndex = nextStyles.findIndex((item) => item.id === style.id && item.tryonImage);
        const activeIndex = generatedIndex >= 0 && !this.data.currentImage
          ? generatedIndex
          : firstImageIndex >= 0
            ? this.data.currentIndex
            : this.data.currentIndex;
        const activeStyle = nextStyles[activeIndex] || {};

        this.setData({
          styles: nextStyles,
          currentIndex: activeIndex,
          currentStyle: activeStyle,
          currentImage: activeStyle.tryonImage || this.data.currentImage,
          tryonError: firstImageIndex >= 0 ? '' : (errors[0] || ''),
          quota: payload.quota || this.data.quota,
          remainingCount: Math.max(0, TOTAL_COUNT - nextStyles.length)
        });
      } catch (err) {
        const message = err.message || '生成失败';
        errors.push(message);
        const nextStyles = this.data.styles.map((item) => (
          item.id === style.id ? { ...item, tryonError: message } : item
        ));
        this.setData({
          styles: nextStyles,
          tryonError: this.data.currentImage ? '' : message,
          remainingCount: Math.max(0, TOTAL_COUNT - nextStyles.length)
        });
        wx.showToast({ title: message.slice(0, 30), icon: 'none' });
        break;
      }
    }

    const hasImage = this.data.styles.some((style) => style.tryonImage);
    if (!hasImage && errors.length) {
      this.setData({ tryonError: errors[0] });
    }
  },

  async waitForTryOnJob(jobId, label, index, total) {
    if (!jobId) throw new Error('生成任务创建失败');
    for (let attempt = 0; attempt < TRYON_POLL_LIMIT; attempt += 1) {
      await delay(TRYON_POLL_INTERVAL);
      this.setData({
        loadingText: `正在生成第 ${index}/${total} 款试戴图：${label}（约 ${Math.max(2, (attempt + 1) * 2)} 秒）`
      });
      const job = await request(`/api/hair-tryon-job?id=${encodeURIComponent(jobId)}`);
      if (job.quota) this.setData({ quota: job.quota });
      if (job.status === 'done') return job.result || {};
      if (job.status === 'failed') throw new Error(job.error || '试戴图生成失败');
    }
    throw new Error('试戴图生成超时，请稍后重试');
  },

  async recommendMore() {
    if (this.data.loading) return;
    if (!this.data.remainingCount || this.data.quota.remaining <= 0) {
      wx.showToast({ title: '您的今日生成次数已达上限，请明天再来试试吧', icon: 'none' });
      return;
    }
    const start = this.data.styles.length;
    const batch = this.data.recommendations
      .slice(start, start + Math.min(MORE_COUNT, this.data.remainingCount))
      .map((item, index) => ({ ...item, rank: start + index + 1 }));
    if (!batch.length) {
      wx.showToast({ title: '您的今日生成次数已达上限，请明天再来试试吧', icon: 'none' });
      return;
    }
    this.setData({
      styles: this.data.styles.concat(batch),
      remainingCount: Math.max(0, TOTAL_COUNT - start - batch.length)
    });
    try {
      await this.generateTryOns(batch);
    } catch (err) {
      wx.showToast({ title: err.message || '生成失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async resetQuota() {
    try {
      const payload = await request('/api/dev/reset-quota', { method: 'POST' });
      this.setData({ quota: payload.quota || { used: 0, remaining: TOTAL_COUNT, limit: TOTAL_COUNT } });
      wx.showToast({ title: '测试次数已重置' });
    } catch (err) {
      wx.showToast({ title: err.message || '重置失败', icon: 'none' });
    }
  },

  selectStyle(event) {
    const index = Number(event.currentTarget.dataset.index || 0);
    const style = this.data.styles[index] || {};
    if (!style.tryonImage && !style.tryonError) {
      wx.showToast({ title: '这款正在生成中', icon: 'none' });
      return;
    }
    this.setData({
      currentIndex: index,
      currentStyle: style,
      currentImage: style.tryonImage || '',
      tryonError: style.tryonError || ''
    });
  },

  saveImage() {
    if (!this.data.currentImage) return;
    if (/^https?:\/\//i.test(this.data.currentImage)) {
      wx.downloadFile({
        url: this.data.currentImage,
        success: (res) => {
          wx.saveImageToPhotosAlbum({
            filePath: res.tempFilePath,
            success: () => wx.showToast({ title: '已保存' }),
            fail: () => wx.showToast({ title: '保存失败', icon: 'none' })
          });
        },
        fail: () => wx.showToast({ title: '下载图片失败', icon: 'none' })
      });
      return;
    }
    wx.getFileSystemManager().writeFile({
      filePath: `${wx.env.USER_DATA_PATH}/istyle-${Date.now()}.png`,
      data: this.data.currentImage.replace(/^data:image\/\w+;base64,/, ''),
      encoding: 'base64',
      success: ({ filePath }) => {
        wx.saveImageToPhotosAlbum({
          filePath,
          success: () => wx.showToast({ title: '已保存' }),
          fail: () => wx.showToast({ title: '保存失败', icon: 'none' })
        });
      }
    });
  }
});
