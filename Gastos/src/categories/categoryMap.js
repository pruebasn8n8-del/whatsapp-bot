const categories = [
  {
    name: 'Gastos Hormiga',
    keywords: ['cafe', 'café', 'tinto', 'snack', 'dulce', 'empanada', 'mecato', 'chicle', 'gaseosa', 'jugo', 'galleta', 'paquete', 'colombina', 'bocadillo'],
    color: '#FF6B6B',
    savingsRate: 0.70,
    reducible: true,
  },
  {
    name: 'Gastos Necesarios',
    keywords: ['arriendo', 'servicios', 'luz', 'agua', 'internet', 'mercado', 'gas', 'telefono', 'celular', 'salud', 'medicina', 'farmacia', 'eps', 'aseo'],
    color: '#4ECDC4',
    savingsRate: 0.05,
    reducible: false,
  },
  {
    name: 'Transporte',
    keywords: ['uber', 'taxi', 'bus', 'transmilenio', 'gasolina', 'parqueadero', 'peaje', 'sitp', 'didi', 'indriver', 'moto', 'bici'],
    color: '#45B7D1',
    savingsRate: 0.30,
    reducible: true,
  },
  {
    name: 'Alimentación',
    keywords: ['almuerzo', 'cena', 'desayuno', 'restaurante', 'domicilio', 'rappi', 'ifood', 'comida', 'corrientazo', 'hamburguesa', 'pizza', 'pollo', 'sushi'],
    color: '#96CEB4',
    savingsRate: 0.25,
    reducible: true,
  },
  {
    name: 'Gastos Opcionales',
    keywords: ['netflix', 'spotify', 'cine', 'bar', 'ropa', 'suscripcion', 'suscripción', 'fiesta', 'regalo', 'videojuego', 'amazon', 'disney', 'hbo', 'prime', 'youtube', 'claude', 'chatgpt', 'openai'],
    color: '#FFEAA7',
    savingsRate: 0.50,
    reducible: true,
  },
  {
    name: 'Educación',
    keywords: ['curso', 'libro', 'udemy', 'platzi', 'universidad', 'semestre', 'matricula', 'colegio', 'papeleria', 'cuaderno', 'coursera'],
    color: '#DDA0DD',
    savingsRate: 0.00,
    reducible: false,
  },
];

const defaultCategory = {
  name: 'Sin Categoría',
  color: '#B0B0B0',
  savingsRate: 0.20,
  reducible: false,
};

module.exports = { categories, defaultCategory };
