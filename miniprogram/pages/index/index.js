const { request } = require('../../utils/api');

const INITIAL_COUNT = 5;
const MORE_COUNT = 3;
const TOTAL_COUNT = 11;

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
    loading: false,
    loadingText: '',
    cameraReady: false,
    remainingCount: TOTAL_COUNT
  },

  onLoad() {},

  enableCamera() {
    this.setData({ cameraReady: true });
  },

  onCameraError(event) {
    wx.showToast({ title: event.detail && event.detail.errMsg ? event.detail.errMsg : '摄像头不可用', icon: 'none' });
  },

  async captureFrame() {
    const camera = wx.createCameraContext();
    return new Promise((resolve, reject) => {
      camera.takePhoto({
        quality: 'high',
        success: (res) => {
          wx.getFileSystemManager().readFile({
            filePath: res.tempImagePath,
            encoding: 'base64',
            success: (file) => resolve(`data:image/jpeg;base64,${file.data}`),
            fail: reject
          });
        },
        fail: reject
      });
    });
  },

  async startRecommend() {
    if (this.data.loading) return;
    if (!this.data.cameraReady) {
      this.enableCamera();
      wx.showToast({ title: '摄像头开启后再开始推荐', icon: 'none' });
      return;
    }
    try {
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
      await this.generateTryOns(first);
    } catch (err) {
      wx.showToast({ title: err.message || '推荐失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async generateTryOns(styles) {
    this.setData({ loading: true, loadingText: `正在生成 ${styles.length} 款试戴图` });
    const payload = await request('/api/hair-tryon', {
      method: 'POST',
      data: {
        image: this.data.image,
        recommendations: styles,
        limit: styles.length
      }
    });
    const byId = new Map((payload.variants || []).map((item) => [item.id, item]));
    const nextStyles = this.data.styles.map((style) => {
      const generated = byId.get(style.id);
      return generated && generated.image ? { ...style, tryonImage: generated.image } : style;
    });
    const firstIndex = nextStyles.findIndex((style) => style.tryonImage);
    this.setData({
      styles: nextStyles,
      currentIndex: firstIndex >= 0 ? firstIndex : this.data.currentIndex,
      currentStyle: nextStyles[firstIndex >= 0 ? firstIndex : this.data.currentIndex] || {},
      currentImage: nextStyles[firstIndex >= 0 ? firstIndex : this.data.currentIndex]?.tryonImage || '',
      quota: payload.quota || this.data.quota,
      remainingCount: Math.max(0, TOTAL_COUNT - nextStyles.length)
    });
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

  selectStyle(event) {
    const index = Number(event.currentTarget.dataset.index || 0);
    const style = this.data.styles[index] || {};
    this.setData({
      currentIndex: index,
      currentStyle: style,
      currentImage: style.tryonImage || ''
    });
  },

  saveImage() {
    if (!this.data.currentImage) return;
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
