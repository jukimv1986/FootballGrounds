// Name pools per nationality, so generated players, coaches, agents and friends feel plausible
// for where they come from. Surnames are common family names, never famous footballers.

import type { Rng } from '../rng';

interface NamePool {
  first: string[];
  last: string[];
  female: string[];
}

export const NAME_POOLS: Record<string, NamePool> = {
  ENG: {
    first: ['Jack', 'Harry', 'Oliver', 'George', 'Charlie', 'Jacob', 'Alfie', 'Thomas', 'Joe', 'Callum', 'Kieran', 'Reece', 'Liam', 'Mason', 'Tyler', 'Ben', 'Sam', 'Luke', 'Ryan', 'Josh', 'Connor', 'Declan', 'Jordan', 'Marcus', 'Danny', 'Aaron', 'Lewis', 'Nathan', 'Owen', 'Jamie', 'Ethan', 'Kyle'],
    last: ['Smith', 'Jones', 'Taylor', 'Brown', 'Wilson', 'Evans', 'Walker', 'Wright', 'Robinson', 'Thompson', 'Hughes', 'Edwards', 'Green', 'Hall', 'Wood', 'Harris', 'Clarke', 'Jackson', 'Turner', 'Hill', 'Cooper', 'Ward', 'Morris', 'Bennett', 'Barnes', 'Fletcher', 'Hayes', 'Marshall', 'Pearson', 'Shaw', 'Dawson', 'Holmes', 'Lawrence', 'Mills', 'Palmer', 'Sutton', 'Whitaker', 'Ashworth', 'Kershaw', 'Pickford'],
    female: ['Emily', 'Olivia', 'Amelia', 'Sophie', 'Grace', 'Chloe', 'Lucy', 'Ellie', 'Hannah', 'Jessica', 'Megan', 'Holly'],
  },
  GER: {
    first: ['Lukas', 'Leon', 'Jonas', 'Finn', 'Felix', 'Niklas', 'Tim', 'Jan', 'Julian', 'Maximilian', 'Paul', 'Moritz', 'Florian', 'Kevin', 'Marco', 'Dennis', 'Tobias', 'Philipp', 'Sebastian', 'Kai', 'Timo', 'Lennart', 'Nico', 'Robin', 'Benedikt', 'Matthias', 'Jannik', 'Sven', 'Malte', 'Henrik'],
    last: ['Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Schulz', 'Hoffmann', 'Koch', 'Richter', 'Klein', 'Wolf', 'Schröder', 'Neumann', 'Schwarz', 'Zimmermann', 'Braun', 'Krüger', 'Hartmann', 'Lange', 'Werner', 'Krause', 'Lehmann', 'Köhler', 'Maier', 'Brandt', 'Vogel', 'Kaiser', 'Fuchs', 'Seidel', 'Winkler', 'Böhm', 'Kühn', 'Pohl'],
    female: ['Anna', 'Lena', 'Laura', 'Julia', 'Sarah', 'Lea', 'Hannah', 'Marie', 'Sophie', 'Katharina', 'Nina', 'Clara'],
  },
  NED: {
    first: ['Daan', 'Sem', 'Lucas', 'Milan', 'Bram', 'Thijs', 'Jesse', 'Ruben', 'Stijn', 'Niels', 'Joris', 'Wout', 'Jasper', 'Tim', 'Luuk', 'Mats', 'Sven', 'Jurriën', 'Teun', 'Koen', 'Bart', 'Joey', 'Quinten', 'Kenneth', 'Davy', 'Ryan', 'Xavi', 'Justin'],
    last: ['de Jong', 'Jansen', 'de Vries', 'van den Berg', 'van Dijk', 'Bakker', 'Janssen', 'Visser', 'Smit', 'Meijer', 'de Boer', 'Mulder', 'de Groot', 'Bos', 'Vos', 'Peters', 'Hendriks', 'van Leeuwen', 'Dekker', 'Brouwer', 'de Wit', 'Dijkstra', 'Smits', 'de Graaf', 'van der Meer', 'Kok', 'Jacobs', 'Vermeulen', 'van Wijk', 'Koster', 'Prins', 'Huisman'],
    female: ['Emma', 'Julia', 'Sophie', 'Lotte', 'Fleur', 'Sanne', 'Anouk', 'Iris', 'Noa', 'Eva', 'Lieke', 'Femke'],
  },
  ESP: {
    first: ['Pablo', 'Alejandro', 'Daniel', 'Javier', 'Sergio', 'Adrián', 'Álvaro', 'Diego', 'Iker', 'Marcos', 'Mario', 'Hugo', 'Raúl', 'Rubén', 'Iván', 'Carlos', 'Unai', 'Pedro', 'Nacho', 'Óscar', 'Gonzalo', 'Jorge', 'Víctor', 'Borja', 'Aitor', 'Jesús', 'Alberto', 'Rodrigo', 'Fermín', 'Pau'],
    last: ['García', 'Fernández', 'González', 'Rodríguez', 'López', 'Martínez', 'Sánchez', 'Pérez', 'Gómez', 'Martín', 'Jiménez', 'Ruiz', 'Hernández', 'Díaz', 'Moreno', 'Muñoz', 'Álvarez', 'Romero', 'Alonso', 'Gutiérrez', 'Navarro', 'Torres', 'Domínguez', 'Vázquez', 'Ramos', 'Gil', 'Serrano', 'Blanco', 'Molina', 'Castro', 'Ortega', 'Delgado', 'Rubio', 'Marín', 'Iglesias', 'Echeverría'],
    female: ['Lucía', 'María', 'Paula', 'Sara', 'Carla', 'Martina', 'Alba', 'Laura', 'Elena', 'Irene', 'Nerea', 'Claudia'],
  },
  ITA: {
    first: ['Francesco', 'Alessandro', 'Lorenzo', 'Matteo', 'Andrea', 'Gabriele', 'Riccardo', 'Tommaso', 'Davide', 'Federico', 'Giuseppe', 'Marco', 'Luca', 'Simone', 'Nicolò', 'Stefano', 'Daniele', 'Antonio', 'Giacomo', 'Pietro', 'Filippo', 'Emanuele', 'Salvatore', 'Manuel', 'Alessio', 'Gianluca', 'Mattia', 'Christian'],
    last: ['Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci', 'Marino', 'Greco', 'Bruno', 'Gallo', 'Conti', 'De Luca', 'Mancini', 'Costa', 'Giordano', 'Rizzo', 'Lombardi', 'Moretti', 'Barbieri', 'Fontana', 'Santoro', 'Mariani', 'Rinaldi', 'Caruso', 'Ferrara', 'Galli', 'Martini', 'Leone', 'Longo', 'Gentile', 'Villa', 'Pellegrini', 'Monti'],
    female: ['Giulia', 'Sofia', 'Aurora', 'Alice', 'Chiara', 'Martina', 'Francesca', 'Elisa', 'Sara', 'Valentina', 'Beatrice', 'Ginevra'],
  },
  FRA: {
    first: ['Lucas', 'Hugo', 'Théo', 'Nathan', 'Louis', 'Enzo', 'Mathis', 'Jules', 'Antoine', 'Maxime', 'Clément', 'Alexandre', 'Thomas', 'Romain', 'Kylian', 'Moussa', 'Benjamin', 'Yanis', 'Rayan', 'Quentin', 'Florian', 'Adrien', 'Baptiste', 'Kévin', 'Ousmane', 'Aurélien', 'Dayot', 'Mehdi'],
    last: ['Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand', 'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia', 'David', 'Bertrand', 'Roux', 'Vincent', 'Fournier', 'Morel', 'Girard', 'André', 'Mercier', 'Dupont', 'Lambert', 'Bonnet', 'François', 'Martinez', 'Diallo', 'Traoré', 'Camara', 'Mendy', 'Fofana', 'Koné'],
    female: ['Léa', 'Chloé', 'Manon', 'Camille', 'Inès', 'Jade', 'Sarah', 'Louise', 'Zoé', 'Emma', 'Clara', 'Juliette'],
  },
  POR: {
    first: ['João', 'Rodrigo', 'Martim', 'Tiago', 'Diogo', 'Rafael', 'Gonçalo', 'Pedro', 'Tomás', 'Francisco', 'Duarte', 'Bernardo', 'Rúben', 'André', 'Nuno', 'Bruno', 'Vitinha', 'Ricardo', 'Hélder', 'Fábio', 'Nélson', 'Renato', 'Filipe', 'Vasco', 'Luís', 'Miguel'],
    last: ['Silva', 'Santos', 'Ferreira', 'Pereira', 'Oliveira', 'Costa', 'Rodrigues', 'Martins', 'Jesus', 'Sousa', 'Fernandes', 'Gonçalves', 'Gomes', 'Lopes', 'Marques', 'Alves', 'Almeida', 'Ribeiro', 'Pinto', 'Carvalho', 'Teixeira', 'Moreira', 'Correia', 'Mendes', 'Nunes', 'Soares', 'Vieira', 'Monteiro', 'Cardoso', 'Rocha', 'Neves', 'Coelho'],
    female: ['Maria', 'Beatriz', 'Leonor', 'Matilde', 'Inês', 'Carolina', 'Mariana', 'Ana', 'Sofia', 'Rita', 'Joana', 'Catarina'],
  },
  BRA: {
    first: ['Gabriel', 'Lucas', 'Matheus', 'Rafael', 'Thiago', 'Vinícius', 'Felipe', 'Bruno', 'Gustavo', 'Rodrigo', 'Éverton', 'Wesley', 'Douglas', 'Anderson', 'Diego', 'Caio', 'Renan', 'Leandro', 'Júnior', 'Danilo', 'Marcelo', 'Fabinho'],
    last: ['Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Costa', 'Ribeiro', 'Almeida', 'Carvalho', 'Nascimento', 'Araújo', 'Barbosa', 'Rocha', 'Moura', 'Cardoso', 'Teixeira', 'Freitas', 'Barros', 'Pinheiro', 'Cavalcanti', 'Farias'],
    female: ['Ana', 'Beatriz', 'Larissa', 'Camila', 'Fernanda', 'Juliana', 'Letícia', 'Bruna'],
  },
  ARG: {
    first: ['Santiago', 'Mateo', 'Facundo', 'Nicolás', 'Gonzalo', 'Lautaro', 'Julián', 'Emiliano', 'Agustín', 'Franco', 'Leandro', 'Ezequiel', 'Maximiliano', 'Federico', 'Tomás', 'Joaquín', 'Rodrigo', 'Exequiel', 'Thiago', 'Valentín'],
    last: ['González', 'Rodríguez', 'Gómez', 'Fernández', 'López', 'Díaz', 'Martínez', 'Pérez', 'Romero', 'Sosa', 'Álvarez', 'Torres', 'Ruiz', 'Ramírez', 'Flores', 'Acosta', 'Benítez', 'Medina', 'Herrera', 'Aguirre', 'Pereyra', 'Giménez', 'Molina', 'Correa'],
    female: ['Valentina', 'Camila', 'Martina', 'Lucía', 'Florencia', 'Agustina', 'Sofía', 'Milagros'],
  },
  BEL: {
    first: ['Arthur', 'Louis', 'Noah', 'Jules', 'Lucas', 'Victor', 'Adam', 'Mathis', 'Wout', 'Thibaut', 'Axel', 'Yannick', 'Dries', 'Leandro', 'Jérémy', 'Senne', 'Arne', 'Maarten'],
    last: ['Peeters', 'Janssens', 'Maes', 'Jacobs', 'Mertens', 'Willems', 'Claes', 'Goossens', 'Wouters', 'De Smet', 'Dubois', 'Lambert', 'Dupont', 'Hermans', 'Vermeulen', 'Van Damme', 'Michiels', 'Declercq', 'Aerts', 'Lemmens'],
    female: ['Emma', 'Louise', 'Elise', 'Marie', 'Lina', 'Nora', 'Febe', 'Lotte'],
  },
  CRO: {
    first: ['Luka', 'Ivan', 'Marko', 'Josip', 'Mateo', 'Ante', 'Filip', 'Petar', 'Domagoj', 'Mario', 'Nikola', 'Dario', 'Tin', 'Borna', 'Lovro', 'Duje', 'Mislav', 'Marin'],
    last: ['Horvat', 'Kovačević', 'Babić', 'Marić', 'Jurić', 'Novak', 'Knežević', 'Vuković', 'Marković', 'Petrović', 'Matić', 'Tomić', 'Pavlović', 'Božić', 'Blažević', 'Grgić', 'Perić', 'Barišić', 'Šimić', 'Radić'],
    female: ['Ana', 'Lucija', 'Mia', 'Ema', 'Petra', 'Ivana', 'Marija', 'Lana'],
  },
  URU: {
    first: ['Federico', 'Rodrigo', 'Matías', 'Diego', 'Nicolás', 'Facundo', 'Agustín', 'Maximiliano', 'Sebastián', 'Martín', 'Gastón', 'Gonzalo', 'Ronald', 'Darwin', 'Manuel', 'Mathías'],
    last: ['Rodríguez', 'González', 'Fernández', 'Pérez', 'Martínez', 'Silva', 'Sosa', 'Suárez', 'Méndez', 'Olivera', 'Pereira', 'Cabrera', 'Núñez', 'Viera', 'Castro', 'Acosta', 'De León', 'Laxalt'],
    female: ['Sofía', 'Valentina', 'Florencia', 'Lucía', 'Camila', 'Agustina'],
  },
  NGA: {
    first: ['Chinedu', 'Emeka', 'Oluwaseun', 'Tunde', 'Chukwuemeka', 'Samuel', 'Victor', 'Ahmed', 'Kelechi', 'Ademola', 'Wilfred', 'Moses', 'Ikechukwu', 'Tochukwu', 'Babajide', 'Joshua', 'Taiwo', 'Kenneth'],
    last: ['Okafor', 'Adeyemi', 'Okonkwo', 'Eze', 'Balogun', 'Ogunleye', 'Nwosu', 'Adebayo', 'Olawale', 'Chukwu', 'Onyeka', 'Ibrahim', 'Musa', 'Obi', 'Nwankwo', 'Uzor', 'Akinola', 'Ndidi', 'Iwu', 'Ejike'],
    female: ['Chiamaka', 'Ngozi', 'Adaeze', 'Folake', 'Amina', 'Zainab', 'Ifeoma', 'Temi'],
  },
  SEN: {
    first: ['Moussa', 'Ibrahima', 'Mamadou', 'Cheikh', 'Pape', 'Abdoulaye', 'Idrissa', 'Ismaïla', 'Kalidou', 'Boulaye', 'Youssouf', 'Nampalys', 'Lamine', 'Babacar', 'Ousmane', 'Alioune'],
    last: ['Diop', 'Ndiaye', 'Sarr', 'Fall', 'Gueye', 'Sow', 'Faye', 'Diallo', 'Cissé', 'Ba', 'Mbaye', 'Seck', 'Thiam', 'Diagne', 'Kouyaté', 'Mendy', 'Ndoye', 'Diatta'],
    female: ['Awa', 'Fatou', 'Aminata', 'Mariama', 'Khady', 'Ndeye', 'Aïssatou', 'Coumba'],
  },
  USA: {
    first: ['Tyler', 'Christian', 'Weston', 'Brenden', 'Josh', 'Zack', 'Tim', 'Gio', 'Jordan', 'DeAndre', 'Cameron', 'Brandon', 'Chase', 'Hunter', 'Cody', 'Landon', 'Clint', 'Sergiño', 'Malik', 'Jalen'],
    last: ['Johnson', 'Williams', 'Miller', 'Davis', 'Anderson', 'Moore', 'Martin', 'Jackson', 'White', 'Harris', 'Robinson', 'Lewis', 'Young', 'Allen', 'King', 'Scott', 'Adams', 'Baker', 'Nelson', 'Carter', 'Mitchell', 'Reyna'],
    female: ['Madison', 'Ashley', 'Taylor', 'Morgan', 'Brooke', 'Alyssa', 'Kayla', 'Jordan'],
  },
  JPN: {
    first: ['Takumi', 'Kaoru', 'Daichi', 'Ritsu', 'Wataru', 'Hiroki', 'Takefusa', 'Junya', 'Yuto', 'Shoya', 'Kento', 'Ao', 'Daizen', 'Ayase', 'Koki', 'Reo', 'Yuki', 'Sho'],
    last: ['Sato', 'Suzuki', 'Takahashi', 'Tanaka', 'Watanabe', 'Ito', 'Yamamoto', 'Nakamura', 'Kobayashi', 'Kato', 'Yoshida', 'Yamada', 'Sasaki', 'Yamaguchi', 'Matsumoto', 'Inoue', 'Kimura', 'Hayashi', 'Shimizu', 'Endo'],
    female: ['Yui', 'Aoi', 'Hina', 'Sakura', 'Mei', 'Rin', 'Haruka', 'Yuna'],
  },
  SWE: {
    first: ['Erik', 'Lars', 'Oscar', 'Viktor', 'Emil', 'Anton', 'Isak', 'Gustav', 'Albin', 'Filip', 'Hugo', 'Ludwig', 'Jesper', 'Mattias', 'Dejan', 'Robin', 'Pontus', 'Linus'],
    last: ['Andersson', 'Johansson', 'Karlsson', 'Nilsson', 'Eriksson', 'Larsson', 'Olsson', 'Persson', 'Svensson', 'Gustafsson', 'Pettersson', 'Jonsson', 'Lindberg', 'Lindqvist', 'Berg', 'Holm', 'Forsberg', 'Ekdal', 'Lundgren', 'Sandberg'],
    female: ['Elsa', 'Alice', 'Maja', 'Ebba', 'Wilma', 'Astrid', 'Linnea', 'Freja'],
  },
  POL: {
    first: ['Jakub', 'Kacper', 'Szymon', 'Filip', 'Mateusz', 'Bartosz', 'Piotr', 'Krzysztof', 'Kamil', 'Łukasz', 'Tomasz', 'Arkadiusz', 'Grzegorz', 'Przemysław', 'Wojciech', 'Sebastian', 'Karol', 'Michał'],
    last: ['Nowak', 'Kowalski', 'Wiśniewski', 'Wójcik', 'Kowalczyk', 'Kamiński', 'Lewandowicz', 'Zieliński', 'Szymański', 'Woźniak', 'Dąbrowski', 'Kozłowski', 'Jankowski', 'Mazur', 'Krawczyk', 'Piotrowski', 'Grabowski', 'Pawłowski', 'Michalski', 'Zając'],
    female: ['Zuzanna', 'Julia', 'Maja', 'Zofia', 'Hanna', 'Lena', 'Alicja', 'Natalia'],
  },
  MAR: {
    first: ['Achraf', 'Hakim', 'Youssef', 'Sofyan', 'Nayef', 'Azzedine', 'Bilal', 'Munir', 'Abdessamad', 'Ilias', 'Amine', 'Selim', 'Zakaria', 'Noussair', 'Hamza', 'Anass', 'Ayoub', 'Karim'],
    last: ['El Amrani', 'Benali', 'Bennani', 'Alaoui', 'Idrissi', 'Tazi', 'El Idrissi', 'Chakir', 'Amrabat', 'Boufal', 'Ounahi', 'Saïss', 'Mazraoui', 'Ziyech', 'Bounou', 'Aguerd', 'El Khannouss', 'Harit'],
    female: ['Salma', 'Imane', 'Yasmine', 'Nour', 'Aya', 'Kenza', 'Rania', 'Hiba'],
  },
};

export function randomName(rng: Rng, nation: string): { first: string; last: string } {
  const pool = NAME_POOLS[nation] ?? NAME_POOLS.ENG;
  return { first: rng.pick(pool.first), last: rng.pick(pool.last) };
}

export function randomFemaleName(rng: Rng, nation: string): { first: string; last: string } {
  const pool = NAME_POOLS[nation] ?? NAME_POOLS.ENG;
  return { first: rng.pick(pool.female), last: rng.pick(pool.last) };
}

/** foreign nationalities that commonly appear in each league (besides the home nation) */
export const IMPORT_NATIONS: Record<string, string[]> = {
  ENG: ['FRA', 'ESP', 'BRA', 'ARG', 'BEL', 'NED', 'POR', 'NGA', 'SEN', 'USA', 'SWE', 'GER', 'CRO', 'JPN'],
  GER: ['POL', 'NED', 'FRA', 'CRO', 'SWE', 'JPN', 'USA', 'BRA', 'SEN', 'ENG', 'BEL', 'MAR'],
  NED: ['BEL', 'GER', 'MAR', 'SWE', 'NGA', 'BRA', 'JPN', 'POL', 'SEN', 'CRO'],
  ESP: ['ARG', 'BRA', 'URU', 'FRA', 'POR', 'MAR', 'SEN', 'CRO', 'JPN', 'NED'],
  ITA: ['ARG', 'BRA', 'URU', 'CRO', 'FRA', 'POL', 'SEN', 'NGA', 'ESP', 'SWE'],
  FRA: ['SEN', 'MAR', 'NGA', 'BEL', 'BRA', 'POR', 'ARG', 'JPN', 'USA', 'CRO'],
  POR: ['BRA', 'ARG', 'URU', 'ESP', 'NGA', 'SEN', 'MAR', 'JPN', 'USA', 'FRA'],
};
