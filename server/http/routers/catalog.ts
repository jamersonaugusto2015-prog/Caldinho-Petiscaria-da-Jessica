import { Router } from 'express';
import type { Server } from 'socket.io';
import { shopRoom } from '../../../contract/shop/rooms';
import { clearFeaturedProduct, createCategory, createProduct, deleteCategory, deleteProduct, listCategories, listProducts, setFeaturedProduct, updateCategory, updateProduct } from '../../catalog';
import { requireStaff } from '../middleware/auth';
import { shopIdOf } from '../middleware/tenant';

/**
 * O cardápio: categorias e produtos.
 *
 * Router: traduz, autentica e delega. Zero regra de negócio.
 */
export function catalogRouter(io: Server): Router {
  const router = Router();

  // ---------- Categorias (editáveis no painel) ----------
  router.get('/categories', (req, res) => {
    res.json(listCategories(shopIdOf(req)));
  });

  router.post('/categories', requireStaff('kitchen'), (req, res) => {
    const cat = createCategory(shopIdOf(req), req.body ?? {});
    io.to(shopRoom(shopIdOf(req))).emit('categories:updated');
    res.status(201).json(cat);
  });

  router.patch('/categories/:id', requireStaff('kitchen'), (req, res) => {
    const cat = updateCategory(shopIdOf(req), req.params.id, req.body ?? {});
    io.to(shopRoom(shopIdOf(req))).emit('categories:updated');
    res.json(cat);
  });

  router.delete('/categories/:id', requireStaff('kitchen'), (req, res) => {
    deleteCategory(shopIdOf(req), req.params.id);
    io.to(shopRoom(shopIdOf(req))).emit('categories:updated');
    res.json({ ok: true });
  });

  // ---------- Products ----------
  router.get('/products', (req, res) => {
    res.json(listProducts(shopIdOf(req)));
  });

  router.post('/products', requireStaff('kitchen'), (req, res) => {
    const p = createProduct(shopIdOf(req), req.body);
    io.to(shopRoom(shopIdOf(req))).emit('products:updated');
    res.json(p);
  });

  router.patch('/products/:id', requireStaff('kitchen'), (req, res) => {
    const p = updateProduct(shopIdOf(req), req.params.id, req.body ?? {});
    io.to(shopRoom(shopIdOf(req))).emit('products:updated');
    res.json(p);
  });

  router.delete('/products/:id', requireStaff('kitchen'), (req, res) => {
    deleteProduct(shopIdOf(req), req.params.id);
    io.to(shopRoom(shopIdOf(req))).emit('products:updated');
    res.json({ ok: true });
  });

  /**
   * O destaque do dia.
   *
   * O nome antigo era `caldinho-do-dia` — literal demais para uma plataforma
   * onde a loja pode ser uma pizzaria. O caminho velho continua respondendo
   * porque um app já instalado no celular de alguém continua chamando por ele:
   * quebrar a rota é quebrar a cozinha de quem ainda não recarregou a página.
   */
  const DESTAQUE = ['/products/:id/destaque', '/products/:id/caldinho-do-dia'];

  router.post(DESTAQUE, requireStaff('kitchen'), (req, res) => {
    setFeaturedProduct(shopIdOf(req), req.params.id);
    io.to(shopRoom(shopIdOf(req))).emit('products:updated');
    res.json({ ok: true });
  });

  router.delete(DESTAQUE, requireStaff('kitchen'), (req, res) => {
    clearFeaturedProduct(shopIdOf(req));
    io.to(shopRoom(shopIdOf(req))).emit('products:updated');
    res.json({ ok: true });
  });

  return router;
}
