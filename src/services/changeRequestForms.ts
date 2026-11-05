import { formatPhoneCI } from '@/utils/phoneCI';
import { serverChangesOf, type ServerChanges } from './changeRequestChanges';

// Execution of an authorized modification: the admin corrects what the guichetier entered when
// recording the operation (date, line, bus, driver, amounts, names…), with the same kind of fields
// as the guichet's forms. The execution window used to list every column of the record (solde,
// caisse, synced, bus_id…) as free text: the admin could rewrite computed values and technical
// fields, and had to type ids by hand.

export type EditKind =
  | 'text' | 'number' | 'date' | 'time' | 'phone'
  | 'route' | 'bus' | 'driver' | 'expense_type';

export interface EditField {
  /** Key in the request's copy of the operation */
  key: string;
  label: string;
  kind: EditKind;
  /** For a choice (line, bus, driver): key of the copy holding its readable value */
  display?: string;
}

/** Fields entered by the guichetier, by table of the operation. */
const EDIT_FIELDS: Record<string, EditField[]> = {
  // Départ (Nouveau départ)
  schedules: [
    { key: 'departure_date', label: 'Date départ', kind: 'date' },
    { key: 'departure_time', label: 'Heure', kind: 'time' },
    { key: 'route_id', label: 'Ligne', kind: 'route', display: 'route_name' },
    { key: 'bus_id', label: 'Car', kind: 'bus', display: 'bus_plate' },
    { key: 'driver_id', label: 'Chauffeur', kind: 'driver', display: 'driver_name' },
    { key: 'seats_total', label: 'Nombre de sièges', kind: 'number' },
  ],
  // Vente de ticket
  tickets: [
    { key: 'destination', label: 'Destination', kind: 'text' },
    { key: 'seat_number', label: 'N° siège', kind: 'number' },
    { key: 'price', label: 'Tarif', kind: 'number' },
    { key: 'passenger_name', label: 'Nom du passager', kind: 'text' },
    { key: 'passenger_phone', label: 'Téléphone du passager', kind: 'phone' },
  ],
  // Bagage
  bagage_tickets: [
    { key: 'destination', label: 'Destination', kind: 'text' },
    { key: 'price', label: 'Prix bagage', kind: 'number' },
    { key: 'owner_name', label: 'Propriétaire', kind: 'text' },
    { key: 'owner_phone', label: 'Contact', kind: 'phone' },
    { key: 'description', label: 'Description du bagage', kind: 'text' },
  ],
  // Dépense
  counter_charges: [
    { key: 'type', label: 'Type de dépense', kind: 'expense_type' },
    { key: 'amount', label: 'Montant', kind: 'number' },
    { key: 'description', label: 'Libellé', kind: 'text' },
    { key: 'expense_date', label: 'Date de la dépense', kind: 'date' },
  ],
  // Convoi
  convoys: [
    { key: 'amount', label: 'Montant', kind: 'number' },
    { key: 'passengers_count', label: 'Passagers', kind: 'number' },
    { key: 'ratio_amount', label: 'Ratio', kind: 'number' },
    { key: 'carburant_amount', label: 'Carburant', kind: 'number' },
    { key: 'peage_amount', label: 'Péage', kind: 'number' },
    { key: 'autres_amount', label: 'Autres charges', kind: 'number' },
    { key: 'observation', label: 'Observation', kind: 'text' },
  ],
  // Recette de ramassage
  ramassage_notifications: [
    { key: 'collected_places', label: 'Places vendues', kind: 'number' },
    { key: 'collected_amount', label: 'Montant collecté', kind: 'number' },
  ],
  // Courrier
  parcels: [
    { key: 'sender_name', label: 'Expéditeur', kind: 'text' },
    { key: 'sender_phone', label: 'Téléphone expéditeur', kind: 'phone' },
    { key: 'recipient_name', label: 'Destinataire', kind: 'text' },
    { key: 'recipient_phone', label: 'Téléphone destinataire', kind: 'phone' },
    { key: 'recipient_city', label: 'Ville du destinataire', kind: 'text' },
    { key: 'content_description', label: 'Description du contenu', kind: 'text' },
    { key: 'declared_value', label: 'Valeur déclarée', kind: 'number' },
    { key: 'delivery_fee', label: 'Frais d\'envoi', kind: 'number' },
  ],
};

const SAME_TABLE: Record<string, string> = { bagages: 'bagage_tickets', depenses: 'counter_charges' };

/**
 * Fields the admin may correct for this operation. Only those found in the request's copy: a copy
 * made by another screen (e.g. the closing, which keeps no line nor bus) offers fewer fields.
 */
export function editFieldsFor(operationTable: string, snapshot: Record<string, unknown>): EditField[] {
  const fields = EDIT_FIELDS[SAME_TABLE[operationTable] ?? operationTable] ?? [];
  return fields.filter(f => f.key in snapshot || (f.display !== undefined && f.display in snapshot));
}

/** Expense types of the guichet (Nouvelles dépenses). */
export const EXPENSE_TYPES = ['Ratio', 'Carburant', 'Péage', 'Autres'];

/**
 * Values that follow from the edited ones: a parcel's total is its sending fee plus the SMS fee.
 * Returns the copy with them set.
 */
export function withDerivedValues(
  operationTable: string,
  snapshot: Record<string, unknown>,
  edited: Record<string, unknown>,
): Record<string, unknown> {
  if (operationTable === 'parcels' && edited.delivery_fee !== undefined && !Object.is(edited.delivery_fee, snapshot.delivery_fee)) {
    const total = Number(edited.delivery_fee || 0) + Number(snapshot.sms_tracking_fee || 0);
    return { ...edited, total_amount: total };
  }
  return edited;
}

/**
 * What a modification sends to the server: the fields of the form only (changed ones), with the
 * server's column names. The line's name is a column of the departure too; the bus and the driver
 * are sent by id only.
 */
export function formChangesForServer(
  operationTable: string,
  snapshot: Record<string, unknown>,
  edited: Record<string, unknown>,
): ServerChanges {
  const values: Record<string, unknown> = { ...snapshot };
  for (const field of editFieldsFor(operationTable, snapshot)) {
    values[field.key] = edited[field.key];
    if (field.kind === 'route' && field.display) values[field.display] = edited[field.display];
  }
  return serverChangesOf(operationTable, snapshot, withDerivedValues(operationTable, snapshot, values));
}

/** A field's value as the guichet shows it (name of the line rather than its id, 07 59 81 81 55…). */
export function readableValue(field: EditField, values: Record<string, unknown>): string {
  const value = field.display ? values[field.display] ?? values[field.key] : values[field.key];
  if (value === null || value === undefined || value === '') return '—';
  if (field.kind === 'phone') return formatPhoneCI(String(value)) || String(value);
  if (field.kind === 'number') return Number(value).toLocaleString('fr-FR');
  if (field.kind === 'date') return String(value).slice(0, 10).split('-').reverse().join('/');
  if (field.kind === 'time') return String(value).slice(0, 5);
  return String(value);
}
