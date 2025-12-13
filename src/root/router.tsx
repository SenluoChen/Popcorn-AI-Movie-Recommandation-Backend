// src/routes/router.tsx
import { createBrowserRouter } from 'react-router-dom';
import Root from './Root';
import HomePage from '../pages/HomePage';
import ProductDetail from '../pages/ProductDetail';

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Root />, // 主 Layout
    children: [
      {
        index: true, // 預設首頁
        element: <HomePage />,
      },
      {
        path: "dashboard", // 另一個首頁入口
        element: <HomePage />,
      },
      {
        path: "movie/:id",
        element: <ProductDetail />,
      },
    ],
  },
]);

export default router;