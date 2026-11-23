// Le téléphone de l'en-tête raconte un trajet sur la ligne 1, en boucle :
// « Pars maintenant », le compte à rebours à Comédie, puis « Ne rate pas ton arrêt » jusqu'à Port Marianne.

const telephone = document.querySelector(".telephone");
const ecran = telephone.querySelector(".ecran");
const heure = ecran.querySelector(".heure");
const pile = ecran.querySelector(".pile");
const calme = matchMedia("(prefers-reduced-motion: reduce)").matches;

// La date du jour sur l'écran verrouillé, comme un vrai téléphone (« lundi 23 novembre »)
{
  const d = new Date();
  const jour = new Intl.DateTimeFormat("fr-FR", { weekday: "long" }).format(d);
  const mois = new Intl.DateTimeFormat("fr-FR", { month: "long" }).format(d);
  ecran.querySelector(".date").textContent = `${jour} ${d.getDate() === 1 ? "1er" : d.getDate()} ${mois}`;
}

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

function regler(h) {
  if (heure.textContent === h) return;
  heure.classList.add("change");
  setTimeout(() => { heure.textContent = h; heure.classList.remove("change"); }, 200);
}

function vibrer(fois = 1) {
  for (let i = 0; i < fois; i++) {
    setTimeout(() => {
      telephone.classList.remove("secoue");
      void telephone.offsetWidth; // relance l'animation
      telephone.classList.add("secoue");
    }, i * 600);
  }
}

async function montrer(html, classe = "") {
  const n = document.createElement("div");
  n.className = `notif arrive ${classe}`;
  n.innerHTML = html;
  pile.prepend(n);
  ecran.classList.add("occupe");
  requestAnimationFrame(() => requestAnimationFrame(() => n.classList.remove("arrive")));
  return n;
}

async function retirer(n) {
  n.classList.add("part");
  await attendre(400);
  n.remove();
  if (!pile.children.length) ecran.classList.remove("occupe");
}

const ligne1 = '<span class="ligne l1">1</span>';
const icone = (d) => `<svg class="ico" viewBox="0 0 24 24"><path d="${d}"/></svg>`;
const cloche = icone("M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2zm6-6V11a6 6 0 0 0-5-5.9V4a1 1 0 0 0-2 0v1.1A6 6 0 0 0 6 11v5l-2 2v1h16v-1z");
const vibre = icone("M7 4h10a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v12h8V6H8zM2 9h2v6H2V9zm18 0h2v6h-2V9z");

// Arrêts de la ligne 1 après Comédie, vers Gare Sud de France (horaires TaM)
const arrets = [
  ["Gare Saint-Roch", "8:18"], ["Du Guesclin", "8:19"], ["Antigone", "8:21"], ["Léon Blum", "8:23"],
  ["Place de l'Europe", "8:25"], ["Rives du Lez", "8:27"], ["Moularès (Hôtel de Ville)", "8:29"],
];

async function histoire() {
  pile.innerHTML = "";
  ecran.classList.remove("occupe");
  ecran.classList.add("eteint");
  regler("8:09");
  await attendre(1400);

  // 1. Avant de partir
  ecran.classList.remove("eteint");
  await attendre(500);
  const partir = await montrer(`
    <div class="notif-tete">${cloche}Pars maintenant</div>
    <p>${ligne1}<strong>Comédie → Gare Sud de France</strong></p>
    <p class="arrets">Dans 7 min. 6 min à pied : c'est le moment de partir.</p>`);
  vibrer();
  await attendre(3600);
  await retirer(partir);

  // 2. À l'arrêt : le compte à rebours (accéléré)
  regler("8:12");
  const compte = await montrer(`
    <div class="notif-tete fort">${ligne1}Comédie <span class="fleche">→</span> Gare Sud de France</div>
    <p class="decompte">3:47</p>
    <div class="jauge"><span style="width:40%"></span></div>
    <p class="notif-pied">Tu l'as : 5 min à pied, il te reste 2 min de marge</p>`);
  const chiffres = compte.querySelector(".decompte");
  const jauge = compte.querySelector(".jauge span");
  const pied = compte.querySelector(".notif-pied");
  for (let s = 227; s >= 0; s -= 4) {
    chiffres.textContent = s > 90 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : s > 0 ? "À l'approche" : "Il arrive";
    jauge.style.width = `${100 - (s / 380) * 100}%`;
    if (s <= 90) { chiffres.style.fontSize = "28px"; pied.textContent = "Ton tram arrive à Comédie"; }
    regler(`8:${String(16 - Math.ceil(s / 60)).padStart(2, "0")}`);
    await attendre(s > 90 ? 70 : 110);
  }
  await attendre(1200);
  await retirer(compte);

  // 3. Dans le tram : ne rate pas ton arrêt
  regler("8:17");
  const descente = await montrer(`
    <div class="notif-tete">${vibre}Ne rate pas ton arrêt</div>
    <strong class="gros">Descente à Port Marianne</strong>
    <p class="arrets">Prochain arrêt : Gare Saint-Roch · encore 8 arrêts</p>`);
  const texte = descente.querySelector(".arrets");
  for (let i = 0; i < arrets.length; i++) {
    const [nom, h] = arrets[i];
    regler(h);
    texte.textContent = i < arrets.length - 1 ? `Prochain arrêt : ${nom} · encore ${8 - i} arrêts` : `${nom}`;
    await attendre(i < arrets.length - 1 ? 750 : 300);
  }
  descente.classList.add("alerte");
  descente.querySelector(".gros").textContent = "Descends au prochain arrêt";
  texte.textContent = "Port Marianne · arrivée 8:31";
  vibrer(2);
  await attendre(4200);

  // 4. Arrivé : l'écran se met en veille
  regler("8:31");
  await retirer(descente);
  await attendre(900);
  ecran.classList.add("eteint");
  await attendre(1200);
}

async function boucle() {
  for (;;) await histoire();
}

if (!calme) {
  // Le téléphone ne s'anime que lorsqu'il est visible (batterie des visiteurs)
  let lance = false;
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !lance) { lance = true; boucle(); }
  }).observe(telephone);
}

// Les sections apparaissent au défilement
const observateur = new IntersectionObserver((entrees) => {
  for (const e of entrees) {
    if (e.isIntersecting) {
      e.target.classList.add("vu");
      observateur.unobserve(e.target);
    }
  }
}, { threshold: 0.15 });

document.querySelectorAll(".engagements li, .station, .hors-appli, .frais, .faq details").forEach((el) => {
  el.classList.add("reveler");
  observateur.observe(el);
});
