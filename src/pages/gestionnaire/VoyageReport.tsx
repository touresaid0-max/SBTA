import VoyageReport from '../daf/VoyageReport';

/**
 * « Rapports détaillés voyage » of the gestionnaire (27/11/2026): the DAF's report, limited by the
 * server to his company and its subsidiaries (get_gestionnaire_voyage_report).
 */
export default function GestionnaireVoyageReport() {
  return <VoyageReport scope="gestionnaire" />;
}
