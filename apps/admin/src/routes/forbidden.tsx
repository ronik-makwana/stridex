import { Link } from 'react-router'
import { ShieldX } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function ForbiddenPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-4 text-center">
      <ShieldX className="text-muted-foreground size-10" />
      <div>
        <h1 className="text-lg font-semibold">You do not have access to this page</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Ask an administrator if you think this is a mistake.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link to="/">Back to dashboard</Link>
      </Button>
    </div>
  )
}
