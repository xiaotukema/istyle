const app = getApp();

function ensureCloudReady() {
  if (!app.globalData.useCloudContainer || !wx.cloud || !wx.cloud.callContainer) return;
  if (app.globalData.cloudReady) return;
  wx.cloud.init({
    env: app.globalData.cloudEnv || undefined
  });
  app.globalData.cloudReady = true;
}

function uploadCapture(filePath) {
  ensureCloudReady();
  return new Promise((resolve, reject) => {
    const suffix = filePath.includes('.png') ? 'png' : 'jpg';
    const cloudPath = `captures/${Date.now()}-${Math.random().toString(16).slice(2)}.${suffix}`;
    wx.cloud.uploadFile({
      cloudPath,
      filePath,
      success(uploadRes) {
        wx.cloud.getTempFileURL({
          fileList: [uploadRes.fileID],
          success(urlRes) {
            const item = (urlRes.fileList || [])[0] || {};
            if (!item.tempFileURL) {
              reject(new Error('云存储没有返回图片临时地址'));
              return;
            }
            resolve({
              cloudFileId: uploadRes.fileID,
              imageUrl: item.tempFileURL
            });
          },
          fail: reject
        });
      },
      fail: reject
    });
  });
}

function request(path, options = {}) {
  if (app.globalData.useCloudContainer && wx.cloud && wx.cloud.callContainer) {
    ensureCloudReady();
    return new Promise((resolve, reject) => {
      wx.cloud.callContainer({
        config: app.globalData.cloudEnv ? { env: app.globalData.cloudEnv } : undefined,
        path,
        method: options.method || 'GET',
        data: options.data || {},
        header: {
          'X-WX-SERVICE': app.globalData.cloudService,
          'content-type': 'application/json'
        },
        success(res) {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(res.data);
          } else {
            reject(new Error(res.data && res.data.error ? res.data.error : `请求失败：${res.statusCode}`));
          }
        },
        fail: reject
      });
    });
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${app.globalData.apiBase}${path}`,
      method: options.method || 'GET',
      data: options.data || {},
      header: {
        'content-type': 'application/json',
        ...(app.globalData.token ? { Authorization: `Bearer ${app.globalData.token}` } : {})
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data);
        } else {
          reject(new Error(res.data && res.data.error ? res.data.error : `请求失败：${res.statusCode}`));
        }
      },
      fail: reject
    });
  });
}

function login() {
  if (app.globalData.useCloudContainer && wx.cloud && wx.cloud.callContainer) {
    return request('/api/quota').then((data) => {
      app.globalData.quota = data.quota;
      return data;
    });
  }

  return new Promise((resolve, reject) => {
    wx.login({
      success: async ({ code }) => {
        try {
          const data = await request('/api/auth/wechat-login', {
            method: 'POST',
            data: { code }
          });
          app.globalData.token = data.token;
          app.globalData.quota = data.quota;
          resolve(data);
        } catch (err) {
          reject(err);
        }
      },
      fail: reject
    });
  });
}

module.exports = {
  request,
  login,
  uploadCapture
};
