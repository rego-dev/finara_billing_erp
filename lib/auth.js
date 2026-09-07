'use client';

export const getToken = () => (typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null);
export const getUser  = () => {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
};

export const scopedKey = (base) => {
  const u = getUser();
  return u?.id ? `u${u.id}:${base}` : base;
};

export const setSession = (data) => {
  localStorage.setItem('accessToken', data.accessToken);
  localStorage.setItem('refreshToken', data.refreshToken);
  localStorage.setItem('user', JSON.stringify(data.user));
};

export const clearSession = () => {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  localStorage.removeItem('lastActivity');
};

export const isAuthenticated = () => !!getToken();

export const formatCurrency = (amount) =>
  '₱' + Number(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatDate = (date) => {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
};

export const formatNumber = (n, decimals = 2) =>
  new Intl.NumberFormat('en-PH', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(Number(n || 0));
