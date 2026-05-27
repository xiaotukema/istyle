const { request, uploadCapture } = require('../../utils/api');

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
    tryonError: '',
    loading: false,
    loadingText: '',
    remainingCount: TOTAL_COUNT
  },

  onLoad() {},

  onCameraError(event) {
    wx.showToast({ title: event.detail && event.detail.errMsg ? event.detail.errMsg : '摄像头不可用', icon: 'none' });
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
    const pendingStyles = (styles || []).filter((style) => style && !style.tryonImage);
    const errors = [];

    for (let index = 0; index < pendingStyles.length; index += 1) {
      const style = pendingStyles[index];
      this.setData({
        loading: true,
        loadingText: `正在生成第 ${index + 1}/${pendingStyles.length} 款试戴图：${style.label}`
      });

      try {
        const payload = await request('/api/hair-tryon', {
          method: 'POST',
          data: {
            image: this.data.image,
            recommendations: [style],
            limit: 1
          }
        });
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
