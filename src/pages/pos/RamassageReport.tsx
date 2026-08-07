import POSLayout from '@/components/pos/POSLayout';
import { usePOSSession } from '@/services/pos/POSSessionContext';
import RamassageReportView from '@/components/shared/RamassageReportView';

export default function POSRamassageReport() {
  const { session } = usePOSSession();

  return (
    <POSLayout stationName={session?.station_name} activeRoute="Rapport ramassage" showBack>
      <RamassageReportView
        stationId={session?.station_id ?? null}
        stationName={session?.station_name}
      />
    </POSLayout>
  );
}
