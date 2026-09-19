import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { DashboardPage } from '../pages/DashboardPage';
import { ProductDetailPage } from '../pages/ProductDetailPage';
import { NotFoundPage } from '../pages/NotFoundPage';

export const AppRoutes: React.FC = () => {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/products/:id" element={<ProductDetailPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Layout>
  );
};
