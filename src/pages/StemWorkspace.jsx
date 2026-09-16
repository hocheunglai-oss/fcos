import StemActivity from '@/components/common/StemActivity';
import { Link, useParams } from 'react-router-dom';
import StemDetailModal from '@/components/dashboard/StemDetailModal';

export default function StemWorkspace() {
  const { stemId } = useParams();
  return <main className="space-y-4 p-4 lg:p-8">
    <Link to="/my-commitments" className="text-sm text-primary hover:underline">My Commitments</Link>
    <StemDetailModal stemId={stemId} open embedded />
    <StemActivity stemId={stemId} />
  </main>;
}
