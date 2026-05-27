App({
  onLaunch() {
    if (this.globalData.useCloudContainer && wx.cloud) {
      wx.cloud.init({
        env: this.globalData.cloudEnv || undefined
      });
    }
  },

  globalData: {
    useCloudContainer: true,
    cloudEnv: '',
    cloudService: 'istyle',
    apiBase: 'http://127.0.0.1:8000',
    token: '',
    quota: null
  }
});
