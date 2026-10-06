// Realistic-looking but invented names for the LOCAL demo dataset only (3.5I: «the app as if it were real»).
// Built deterministically from common Valencian/Catalan first names and surnames; no list of real people is
// used and no combination refers to anyone. Contact details stay on the reserved @example.test domain and
// evidence files keep their synthetic marker (DATA_MODE=SYNTHETIC_ONLY fences are unchanged).
const GIRLS = ['Laia', 'Júlia', 'Martina', 'Paula', 'Clara', 'Aina', 'Carla', 'Lucía', 'Marina', 'Noa', 'Sara', 'Irene', 'Alba', 'Ona',
  'Neus', 'Mar', 'Elena', 'Valèria', 'Lola', 'Emma', 'Nerea', 'Andrea', 'Maria', 'Ariadna', 'Bruna', 'Candela', 'Daniela', 'Abril', 'Vera',
  'Sofia', 'Gemma', 'Inés', 'Berta', 'Txell', 'Mireia', 'Aitana', 'Nuria', 'Rut', 'Íria', 'Blanca'];
const BOYS = ['Pau', 'Marc', 'Hugo', 'Àlex', 'Joan', 'Nil', 'Biel', 'Jordi', 'Arnau', 'Pol', 'Martí', 'Vicent', 'Pere', 'Adrià', 'Bernat',
  'Lluc', 'Leo', 'Mateu', 'Iker', 'Daniel', 'Sergi', 'Toni', 'Guillem', 'Jaume', 'Enric', 'Roc', 'Izan', 'Òscar', 'Xavier', 'Tomàs',
  'Quim', 'Eloi', 'Gerard', 'Aleix', 'Ferran', 'Hèctor', 'Raül', 'Ivan', 'Oriol', 'David'];
const SURNAMES = ['Ferrer', 'Llopis', 'Martínez', 'García', 'Mascarell', 'Pellicer', 'Gregori', 'Escrivà', 'Morant', 'Canet', 'Sanchis',
  'Femenia', 'Peiró', 'Bataller', 'Climent', 'Faus', 'Mestre', 'Ortolà', 'Puig', 'Ribes', 'Sendra', 'Tormo', 'Vidal', 'Alberola', 'Bolta',
  'Camarena', 'Domènech', 'Estruch', 'Fuster', 'Gil', 'Juan', 'Llorca', 'Marí', 'Navarro', 'Oltra', 'Pons', 'Rubio', 'Savall', 'Server',
  'Soler', 'Taberner', 'Torró', 'Valls', 'Vercher', 'Vives', 'Barber', 'Borràs', 'Calatayud', 'Císcar', 'Frasquet', 'March', 'Pastor',
  'Ripoll', 'Romà', 'Sala', 'Seguí', 'Moll', 'Martí', 'Benavent', 'Cardona', 'Company', 'Costa', 'Esteve', 'Gomar', 'Lloret', 'Miralles',
  'Nadal', 'Perales', 'Reig', 'Segrelles', 'Sabater', 'Tur', 'Bellver', 'Castelló', 'Doménech', 'Ivars', 'Ruiz', 'Montaner', 'Aparisi', 'Grau'];
const ADULT_WOMEN = ['Marta', 'Anna', 'Carme', 'Rosa', 'Isabel', 'Vicenta', 'Amparo', 'Teresa', 'Lourdes', 'Eva', 'Pilar', 'Mònica', 'Raquel',
  'Sílvia', 'Beatriu', 'Cristina', 'Patrícia', 'Laura', 'Elisa', 'Inma'];
const ADULT_MEN = ['Josep', 'Vicent', 'Miquel', 'Francesc', 'Rafael', 'Salvador', 'Enric', 'Antoni', 'Carles', 'David', 'Joaquim', 'Lluís',
  'Ramon', 'Andreu', 'Rubén', 'Manel', 'Jesús', 'Alfons', 'Ximo', 'Nacho'];

/** Family `index` (0-based): two surnames (father's, mother's) and the parents' first names. */
export function familyOf(index) {
  const first = SURNAMES[(index * 7) % SURNAMES.length], second = SURNAMES[(index * 13 + 5) % SURNAMES.length];
  return { surnames: `${first} ${second === first ? SURNAMES[(index * 13 + 6) % SURNAMES.length] : second}`,
    mother: ADULT_WOMEN[(index * 3) % ADULT_WOMEN.length], father: ADULT_MEN[(index * 5 + 2) % ADULT_MEN.length], first, second };
}
/** Child `child` (1-based) of family `index`: alternating girls/boys, never two siblings with the same name. */
export function childName(index, child) {
  const list = (index + child) % 2 ? GIRLS : BOYS;
  return `${list[(index * 11 + child * 17) % list.length]} ${familyOf(index).surnames}`;
}
/** A person outside the families (requests without a record, payers): stable per `n`. */
export function personName(n, { adult = false } = {}) {
  const pool = adult ? (n % 2 ? ADULT_WOMEN : ADULT_MEN) : (n % 2 ? GIRLS : BOYS);
  return `${pool[(n * 7) % pool.length]} ${SURNAMES[(n * 11 + 3) % SURNAMES.length]} ${SURNAMES[(n * 17 + 9) % SURNAMES.length]}`;
}
/** Plain e-mail local part on the reserved test domain (no accents). */
export const mailOf = text => `${text.toLocaleLowerCase('ca').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@example.test`;
