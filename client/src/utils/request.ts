import axios from 'axios';
import { message } from 'antd';

const instance = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000',
  timeout: 10000,
});

instance.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

instance.interceptors.response.use(
  (response) => response.data,
  (error) => {
    message.error(error.response?.data?.message || '请求失败');
    return Promise.reject(error);
  }
);

export const request = instance;