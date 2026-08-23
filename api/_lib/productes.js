/* Grup Scout Parpalló — catàleg de la botiga del grup.
 *
 * Esta llista és l'ÚNICA font de veritat dels preus. El navegador envia només
 * identificadors i quantitats; el total el torna a calcular el servidor amb
 * estos preus. Així, encara que algú manipule el formulari des del navegador,
 * no pot reservar una sudadera a 0 €.
 *
 * Els preus estan en CÈNTIMS, a propòsit: amb decimals en coma flotant,
 * 0.1 + 0.2 no fa 0.3 i els totals acaben eixint amb cèntims fantasma.
 *
 * merchandising.html ha de coincidir amb esta llista (mateixos identificadors
 * i mateixos preus). Hi ha una prova automàtica que ho comprova: si algú canvia
 * un preu només en un dels dos llocs, `npm test` falla.
 */

export const CATEGORIES = [
  { id: "vestimenta", va: "Vestimenta scout", es: "Vestimenta scout" },
  { id: "complements", va: "Complements", es: "Complementos" },
  { id: "insignies", va: "Insígnies", es: "Insignias" },
];

export const PRODUCTES = [
  {
    id: "sudadera",
    cat: "vestimenta",
    preu: 2000,
    img: "img/merch-sudadera.webp",
    va: {
      nom: "Sudadera",
      desc: "Amb el logo de la flor de lis a la part frontal, el disseny propi del grup a l'esquena i el nom del grup a les mànegues.",
    },
    es: {
      nom: "Sudadera",
      desc: "Con el logo de la flor de lis en la parte frontal, el diseño propio del grupo en la espalda y el nombre del grupo en las mangas.",
    },
  },
  {
    id: "polar",
    cat: "vestimenta",
    preu: 2000,
    img: "img/merch-polar.webp",
    va: {
      nom: "Polar",
      desc: "Polar del Grup Scout Parpalló amb la cérvola serigrafiada a l'esquena. Peça còmoda que evita la pèrdua de calor, amb cremallera central.",
    },
    es: {
      nom: "Polar",
      desc: "Polar del Grup Scout Parpalló con la cierva serigrafiada en la espalda. Prenda cómoda que evita la pérdida de calor, con cremallera central.",
    },
  },
  {
    id: "camiseta",
    cat: "vestimenta",
    preu: 800,
    img: "img/merch-camiseta.webp",
    va: {
      nom: "Camiseta morada",
      desc: "Camiseta de màniga curta amb el color morat del grup i la cérvola serigrafiada en blanc.",
    },
    es: {
      nom: "Camiseta morada",
      desc: "Camiseta de manga corta con el color morado del grupo y la cierva serigrafiada en blanco.",
    },
  },
  {
    id: "polo-llis",
    cat: "vestimenta",
    preu: 2000,
    img: "img/merch-polo-llis.webp",
    va: {
      nom: "Polo de màniga curta, llis",
      desc: "Polo de màniga curta sense cap logotip. Peça còmoda i lleugera per als mesos de calor.",
    },
    es: {
      nom: "Polo de manga corta, liso",
      desc: "Polo de manga corta sin ningún logotipo. Prenda cómoda y ligera para los meses de calor.",
    },
  },
  {
    id: "polo-insignia",
    cat: "vestimenta",
    preu: 2000,
    img: "img/merch-polo-insignia.webp",
    va: {
      nom: "Polo de màniga curta amb insígnia",
      desc: "Polo de màniga curta amb la flor de lis. Peça còmoda i lleugera per als mesos de calor.",
    },
    es: {
      nom: "Polo de manga corta con insignia",
      desc: "Polo de manga corta con la flor de lis. Prenda cómoda y ligera para los meses de calor.",
    },
  },
  {
    id: "panoleta",
    cat: "complements",
    preu: 100,
    img: "img/merch-panoleta.webp",
    va: {
      nom: "Pañoleta del Parpalló",
      desc: "Pañoleta groga amb el logo i el text en morat, la del Grup Scout Parpalló de Gandia.",
    },
    es: {
      nom: "Pañoleta del Parpalló",
      desc: "Pañoleta amarilla con el logo y el texto en morado, la del Grup Scout Parpalló de Gandia.",
    },
  },
  {
    id: "bossa",
    cat: "complements",
    preu: 300,
    img: "img/merch-bossa.webp",
    va: {
      nom: "Bossa motxilla",
      desc: "Còmoda bossa-motxilla per a portar objectes menuts.",
    },
    es: {
      nom: "Bolsa mochila",
      desc: "Cómoda bolsa-mochila para llevar objetos pequeños.",
    },
  },
  {
    id: "insignia-cervola",
    cat: "insignies",
    preu: 500,
    img: "img/merch-insignia-cervola.webp",
    va: {
      nom: "Insígnia de la cérvola",
      desc: "La insígnia del Grup Scout Parpalló de Gandia: la cérvola sobre fons roig i verd.",
    },
    es: {
      nom: "Insignia de la cierva",
      desc: "La insignia del Grup Scout Parpalló de Gandia: la cierva sobre fondo rojo y verde.",
    },
  },
  {
    id: "insignia-lis",
    cat: "insignies",
    preu: 300,
    img: "img/merch-insignia-lis.webp",
    va: {
      nom: "Insígnia flor de lis SSVV",
      desc: "La flor de lis brodada sobre fons morat, logotip de Scouts Valencians.",
    },
    es: {
      nom: "Insignia flor de lis SSVV",
      desc: "La flor de lis bordada sobre fondo morado, logotipo de Scouts Valencians.",
    },
  },
  {
    id: "insignia-tropa",
    cat: "insignies",
    preu: 300,
    img: "img/merch-insignia-tropa.webp",
    va: {
      nom: "Insígnia de la Tropa",
      desc: "El nus margarida: el llaç amb els companys i companyes de patrulla, que acaba sent part del mateix element.",
    },
    es: {
      nom: "Insignia de la Tropa",
      desc: "El nudo margarita: el lazo con los compañeros y compañeras de patrulla, que acaba siendo parte del mismo elemento.",
    },
  },
  {
    id: "insignia-estol",
    cat: "insignies",
    preu: 300,
    img: "img/merch-insignia-estol.webp",
    va: {
      nom: "Insígnia de l'Estol",
      desc: "El llobató segueix la petjada del llop més expert: Akela l'introduirà en la selva i n'anirà descobrint les normes i els valors.",
    },
    es: {
      nom: "Insignia de la Manada",
      desc: "El lobato sigue la huella del lobo más experto: Akela lo introducirá en la selva y así irá descubriendo sus normas y sus valores.",
    },
  },
];

/* Índex per identificador, per a no recórrer la llista en cada comprovació. */
const PER_ID = new Map(PRODUCTES.map((p) => [p.id, p]));

export function producte(id) {
  return PER_ID.get(id) || null;
}

/* Formata cèntims com a preu llegible: 2000 -> "20 €", 150 -> "1,50 €". */
export function preuText(centims) {
  return centims % 100 === 0
    ? `${centims / 100} €`
    : `${(centims / 100).toFixed(2).replace(".", ",")} €`;
}
