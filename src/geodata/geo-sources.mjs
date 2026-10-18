/* The licensing gate: which data may appear in a public, commercial product, and why not.

   The inventory in sources.json records facts; this module turns them into a decision the rest of the
   code has to live with. Two questions are asked separately, because conflating them is how projects end
   up shipping data they may not ship:

     * may we *use* it (licence.commercialUse and licence.redistribution)?
     * may we *read* it in an automated way (access.automatable)?

   A source has to answer yes to both to be production-eligible, and the inventory's own `productionEligible`
   flag is checked against its fields rather than trusted, so an entry cannot quietly claim eligibility
   while stating a non-commercial licence. */

export const REQUIRED_FIELDS = Object.freeze(['id', 'kind', 'publisher', 'product', 'methodology', 'resolution',
  'units', 'temporal', 'coverage', 'access', 'licence', 'limitations', 'productionEligible']);

export function validateSource(source) {
  if (!source || typeof source !== 'object') throw new Error('sources: an entry must be an object');
  const missing = REQUIRED_FIELDS.filter(field => source[field] === undefined || source[field] === null);
  if (missing.length) throw new Error('sources: ' + source.id + ' is missing ' + missing.join(', '));
  if (!source.access || typeof source.access.url !== 'string') throw new Error('sources: ' + source.id + ' has no access URL');
  if (!source.licence || typeof source.licence.class !== 'string') throw new Error('sources: ' + source.id + ' has no licence class');
  if (!Array.isArray(source.limitations) || !source.limitations.length) {
    throw new Error('sources: ' + source.id + ' states no limitations, which is not credible for any dataset');
  }
  return source;
}

export function validateInventory(inventory) {
  if (!inventory || !Array.isArray(inventory.sources)) throw new Error('sources: inventory has no sources array');
  const seen = new Set();
  for (const source of inventory.sources) {
    validateSource(source);
    if (seen.has(source.id)) throw new Error('sources: duplicate id ' + source.id);
    seen.add(source.id);
  }
  return inventory;
}

/* The decision, derived only from the recorded facts. `commercialUse` may be the string 'unclear' or
   'quoting facts is permitted...' for human reading, so anything that is not literally true is a refusal. */
export function productionVerdict(source) {
  validateSource(source);
  const blockers = [];
  if (source.licence.commercialUse !== true) blockers.push('licence does not permit commercial use (' + source.licence.class + ')');
  if (source.licence.redistribution !== true) blockers.push('licence does not permit redistribution (' + String(source.licence.redistribution) + ')');
  // Share-alike is a redistribution obligation rather than a permission: shipping a derived database is a
  // deliberate product decision, not something a gate should infer from a permissive-sounding licence.
  if (source.licence.shareAlike === true && source.productionShareAlikeAccepted !== true) {
    blockers.push('share-alike licence: derived data would have to carry the same licence, which needs an explicit product decision');
  }
  if (!source.access || source.access.automatable !== true) blockers.push('no automated access method');
  const eligible = blockers.length === 0;
  if (eligible !== source.productionEligible) {
    throw new Error('sources: ' + source.id + ' claims productionEligible=' + source.productionEligible +
      ' but its own facts say ' + eligible + ' (' + blockers.join('; ') + ')');
  }
  return { id: source.id, eligible, blockers };
}

export function gateReport(inventory) {
  validateInventory(inventory);
  const verdicts = inventory.sources.map(productionVerdict);
  return { eligible: verdicts.filter(verdict => verdict.eligible).map(verdict => verdict.id),
    blocked: verdicts.filter(verdict => !verdict.eligible)
      .map(verdict => ({ id: verdict.id, blockers: verdict.blockers })),
    routing: (inventory.routing || []).map(entry => ({ id: entry.id, verdict: entry.verdict })) };
}

/* What a prototype is allowed to do with a source: research use is broader than production use, but it is
   still bounded by the licence. A non-commercial source may be read for research and may not be shipped. */
export function researchVerdict(source) {
  validateSource(source);
  const blockers = [];
  if (source.licence.class === 'noncommercial-only') blockers.push('research use only: derived values may not enter a commercial product');
  if (source.licence.class === 'terms-uncertain') blockers.push('do not republish until the licence is clarified in writing');
  if (!source.access || (source.access.automatable !== true && !source.access.authentication)) {
    blockers.push('no documented access method');
  }
  return { id: source.id, researchUsable: blockers.length < 2, notes: blockers };
}

export function sourceById(inventory, id) {
  const source = (inventory.sources || []).find(entry => entry.id === id);
  if (!source) throw new Error('sources: unknown source ' + id);
  return source;
}

/* Provenance strings for anything displayed or exported: the publisher, the product and the checked date,
   so a claim can be traced without the reader having this file open. */
export function attributionFor(inventory, id) {
  const source = sourceById(inventory, id);
  return { id, publisher: source.publisher, product: source.product,
    attribution: source.licence.attribution, licence: source.licence.name,
    checkedAt: source.checked_at || inventory.checked_at || null };
}
